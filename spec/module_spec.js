'use strict';
var Module = require('module');
var fs = require('fs');
var ApplicationModule = require('../lib/index');
var utils = require('app-next/lib/helpers/utils');
var request = require('co-request');

/*global spyOn, jasmine, expect, describe*/

var Logger = function () {
  var m = ['info', 'error', 'warn', 'debug', 'silly'];
  var logger = jasmine.createSpyObj('Router', ['info', 'error', 'warn', 'debug', 'silly']);

  if (process.env.WITH_LOGS) {
    for (var fn of m) {
      /*eslint-disable no-console*/
      logger[fn].and.callFake(console.log.bind(console));
    }
  }

  return logger;
};

var Router = function () {
  return jasmine.createSpyObj('Router', ['route', 'use', 'get', 'head', 'post', 'put', 'del', 'delete']);
}

var AppInterface = function () {
  return {
    schemas: {},
    models: {},
    helpers: {},
    api: {},
    validators: {},
    utils: utils,
    HTTPError: {},
    HTTPStatus: {},
    Schema: jasmine.createSpy('Schema').and.callFake(function (schema) {return schema}),
    getSchema: jasmine.createSpy('getSchema').and.callFake(function (name) {return this.schemas[name]}),
    model: jasmine.createSpy('model').and.callFake(function () {return this._models.shift()}),
    Router: Router,
    Logger: Logger,
    router: new Router(),
    logger: new Logger(),
    moduleDescriptor: {path: `${__dirname}/fixtures`, packageInfo: {}},
    moduleName: 'Name'
  }
}

// disables loadApi, loadRoutes, loadApi
function spyOnLoaders() {
  spyOn(ApplicationModule.prototype, 'loadApi');
  spyOn(ApplicationModule.prototype, 'loadRoutes');
  spyOn(ApplicationModule.prototype, 'loadSchemas');
}

function isReadonly(obj, key, value) {
  expect(obj[key]).toBe(value, `expected ${key} to be proxied`);
  expect(() => obj[key] = 1).toThrow();
}

describe('ApplicationModule', function () {
  describe('#constructor', function () {
    var mod;
    var appInterface = new AppInterface();
    var config = {};

    beforeEach(function () {
      spyOn(ApplicationModule.prototype, 'loadApi').and.callFake(function () {
        // ensure api object is ready and already contain a ref to the module
        expect(this.api).toEqual(jasmine.any(Object));
        expect(this.api.module).toBe(this);
      });
      spyOn(ApplicationModule.prototype, 'loadRoutes');
      spyOn(ApplicationModule.prototype, 'loadSchemas');
    });

    it('app exposes start function', function () {
      expect(new ApplicationModule(appInterface).start).not.toThrow();
    });

    it('app interface is mondatory', function () {
      expect(() => new ApplicationModule()).toThrowError(TypeError);
    });

    it('defaults config to empty object', function () {
      mod = new ApplicationModule(appInterface);
      expect(mod.config).toEqual(jasmine.any(Object));
    });

    it('exposes interface, config, and api', function () {
      mod = new ApplicationModule(appInterface, config);
      expect(mod.config).toBe(config);
      expect(mod.app).toBe(appInterface);
    });

    it('loads api, routes and schemas', function () {
      mod = new ApplicationModule(appInterface, config);
      expect(mod.loadApi).toHaveBeenCalled();
      expect(mod.loadRoutes).toHaveBeenCalled();
      expect(mod.loadSchemas).toHaveBeenCalled();
    })
  });

  describe('accessors', function() {
    var mod;
    var appInterface = new AppInterface();

    beforeEach(function () {
      spyOnLoaders();
      mod = new ApplicationModule(appInterface);
    });

    it('proxies app interface properties as readonly', function () {
      isReadonly(mod, 'utils', appInterface.utils);
      isReadonly(mod, 'validators', appInterface.validators);
      isReadonly(mod, 'HTTPError', appInterface.HTTPError);
      isReadonly(mod, 'HTTPStatus', appInterface.HTTPStatus);
      isReadonly(mod, 'schemas', appInterface.schemas);
      isReadonly(mod, 'models', appInterface.models);
      isReadonly(mod, 'router', appInterface.router);
      isReadonly(mod, 'logger', appInterface.logger);
    });

    it('paths', function () {
      mod.descriptor.packageInfo.main = 'lib/index.js';
      isReadonly(mod, 'libDir', appInterface.moduleDescriptor.path + '/lib');
      mod.descriptor.packageInfo.main = 'index.js';
      isReadonly(mod, 'libDir', appInterface.moduleDescriptor.path);
      mod.descriptor.packageInfo.main = null;
      isReadonly(mod, 'libDir', appInterface.moduleDescriptor.path);
      mod.descriptor.packageInfo.main = 'sub/sub/index.js';
      isReadonly(mod, 'apiDir', mod.libDir + '/api');
      isReadonly(mod, 'routesDir', mod.libDir + '/routes');
      isReadonly(mod, 'schemasDir', mod.libDir + '/schemas');
    });

    it('request as readonly', function () {
      isReadonly(mod, 'request', request);
    });
  });

  describe('#model', function() {
    it('returns app model', function () {
      spyOnLoaders()

      var expected = {};
      var appInterface = new AppInterface();
      var mod = new ApplicationModule(appInterface);
      appInterface._models = [expected];

      var model = mod.model(1);
      expect(appInterface.model).toHaveBeenCalled();
      expect(appInterface.model.calls.argsFor(0)).toEqual([1]);
      expect(model).toBe(expected);
      expect(model.module).toBe(mod);
    });
  });

  describe('#getSchema', function() {
    it('process schema', function () {
      spyOnLoaders();

      var expected = {};
      var appInterface = new AppInterface();
      var mod = new ApplicationModule(appInterface);
      appInterface.schemas[1] = expected;

      var schema = mod.getSchema(1, 2);
      expect(appInterface.getSchema).toHaveBeenCalledWith(1, 2);
      expect(schema).toBe(expected);
    });
  });

  describe('#setupRouteHandler', function() {
    var mod;
    var appInterface;
    beforeEach(function () {
      spyOnLoaders();
      appInterface = new AppInterface();
      mod = new ApplicationModule(appInterface);
    });

    it('the handler must be defined', function () {
      expect(mod.setupRouteHandler('someRoute', null)).toBeUndefined();
    });

    it('calls the handler if not a generator', function () {
      var handler = jasmine.createSpy('handler');
      mod.setupRouteHandler('someRoute', handler);
      expect(handler).toHaveBeenCalled();
    });

    it('calls route handler with correct params and proxies its return value', function () {
      appInterface.router = {
        route: jasmine.createSpy('route').and.returnValue(1)
      }

      var handler = function* () {};
      var obj = mod.setupRouteHandler('someRoute', handler, 'method');
      expect(obj).toBe(1);
      expect(appInterface.router.route).toHaveBeenCalledWith(jasmine.objectContaining({
        path: 'someRoute',
        handler: handler,
        method: 'METHOD'
      }));
    });

    it('default method to GET', function () {
      appInterface.router = {
        route: jasmine.createSpy('route').and.returnValue(1)
      }

      var handler = function* () {};
      var obj = mod.setupRouteHandler('someRoute', handler);
      expect(obj).toBe(1);
      expect(appInterface.router.route).toHaveBeenCalledWith(jasmine.objectContaining({
        path: 'someRoute',
        handler: handler,
        method: 'GET'
      }));
    });

    it('adds validate object', function () {
      appInterface.router = {
        route: jasmine.createSpy('route').and.returnValue(1)
      }

      var handler = function* () {};
      var validate = {};
      var obj = mod.setupRouteHandler('someRoute', handler, 'method', {}, validate);
      expect(obj).toBe(1);
      expect(appInterface.router.route).toHaveBeenCalledWith(jasmine.objectContaining({
        path: 'someRoute',
        handler: handler,
        validate: validate,
        method: 'METHOD'
      }));
    });

    it('calls validate object', function () {
      appInterface.router = {
        route: jasmine.createSpy('route').and.returnValue(1)
      }

      var handler = function* () {};
      var validate = {};
      var validateSpy = jasmine.createSpy('validate').and.callFake(function (validate) {
        expect(this).toBe(mod);
        expect(validate).toBe(mod.validators);
        return validate;
      });
      var obj = mod.setupRouteHandler('someRoute', handler, 'method', validateSpy);
      expect(validateSpy).toHaveBeenCalled();
      expect(obj).toBe(1);
      expect(appInterface.router.route).toHaveBeenCalledWith(jasmine.objectContaining({
        path: 'someRoute',
        handler: handler,
        validate: validate,
        method: 'METHOD'
      }));
    });
  });

  describe('#setupModuleRoutes', function() {
    it('handle module', function () {
      spyOnLoaders();
      var appInterface = new AppInterface();
      var mod = new ApplicationModule(appInterface);

      var methods = [];
      var route = {
        head: 1,
        headValidate: 1,
        get: 2,
        getValidate: 2,
        post: 3,
        postValidate: 3,
        put: 4,
        putValidate: 4,
        del: 5,
        delValidate: 5,
        delete: 6,
        deleteValidate: 6,
        nonHTTPMethod: 7,
        nonHTTPMethodValidate: 7
      }
      spyOn(mod, 'setupRouteHandler').and.callFake(function (path, handler, method, validate) {
        if (handler === route) {
          expect(method.toLowerCase()).toBe('get');
          return;
        }
        expect(path).toBe('route');
        expect(handler).toEqual(jasmine.any(Number));
        expect(validate).toEqual(handler); // ensure submitting its attached handler
        methods.push(method);
      });
      mod.setupModuleRoutes('route', route);
      expect(mod.setupRouteHandler.calls.count()).toBe(7);
      expect(mod.setupRouteHandler.calls.argsFor(0)).toEqual(['route', route, 'GET', undefined]);
      expect(methods.sort()).toEqual(['get', 'head', 'post', 'put', 'delete', 'del'].sort());
    });
  });

  it('#serializeRoute', function() {
    spyOnLoaders();
    var appInterface = new AppInterface();
    var mod = new ApplicationModule(appInterface);
    expect(mod.serializeRoute('_arg_')).toBe(':arg');
    expect(mod.serializeRoute('arg')).toBe('arg');
  });

  describe('#loadApi', function() {
    it('correclty loads api', function () {
      spyOn(ApplicationModule.prototype, 'loadApi').and.callThrough();
      spyOn(ApplicationModule.prototype, 'loadSchemas');
      spyOn(ApplicationModule.prototype, 'loadRoutes');
      var appInterface = new AppInterface();
      var mod = new ApplicationModule(appInterface);
      expect(mod.loadApi).toHaveBeenCalled();
      expect(mod.api.ns1).toEqual(jasmine.any(Object));
      expect(mod.api.ns1.fn1).toEqual(jasmine.any(Function));
      expect(mod.api.ns1.module).toBe(mod);
      expect(mod.api.ns2).toEqual(jasmine.any(Object));
      expect(mod.api.ns2.fn1).toEqual(jasmine.any(Function));
      expect(mod.api.ns2.fn2).toEqual(jasmine.any(Function));
      expect(mod.api.ns2.module).toBe(mod);
      mod.descriptor.path = __dirname;
      mod.api = {};
      expect(mod.loadApi()).toBe(false);
    });
  });

  describe('#loadSchema', function () {
    var appInterface;
    var mod;
    var fnSchemaReturn = {};
    var fnSchema = jasmine.createSpy('fnSchema').and.returnValues(fnSchemaReturn, null);
    var objSchema = {};

    beforeEach(function () {
      spyOnLoaders();
      appInterface = new AppInterface();
      mod = new ApplicationModule(appInterface);
      spyOn(Module.prototype, 'require').and.callFake((name) => /fn$/.test(name) ? fnSchema : objSchema);
    });

    it('throws if module does not exit', function () {
      Module.prototype.require.and.throwError();
      expect(() => mod.loadSchema('no')).toThrow();
    });

    it('calls app.model with name and schema', function () {
      var result = {};
      appInterface._models = [result];
      var model = mod.loadSchema('obj');
      expect(appInterface.model).toHaveBeenCalledWith('obj', objSchema);
      expect(model).toBe(result); // returns the result of appInterface#model
    });

    it('returns the already loaded model', function () {
      appInterface.schemas.existant = {};
      expect(mod.loadSchema('existant')).toBe(appInterface.schemas.existant);
    });

    it('calls function to return a schema and throw error if not an object', function () {
      var result = {};
      appInterface._models = [result];
      var model = mod.loadSchema('fn');
      expect(fnSchema).toHaveBeenCalled();
      expect(appInterface.model).toHaveBeenCalledWith('fn', fnSchemaReturn);
      expect(model).toBe(result); // returns the result of appInterface#model
      expect(() => mod.loadSchema('fn')).toThrow();
    });
  });

  describe('#loadSchemas', function () {
    var appInterface;
    var mod;

    beforeEach(function () {
      var obj = {isDirectory: jasmine.createSpy().and.returnValues(false, false, true, false)};
      mod = null;
      appInterface = new AppInterface();
      spyOn(ApplicationModule.prototype, 'loadSchema').and.throwError('yes');
      spyOn(ApplicationModule.prototype, 'loadApi');
      spyOn(ApplicationModule.prototype, 'loadSchemas').and.callThrough();
      spyOn(ApplicationModule.prototype, 'loadRoutes');
      spyOn(fs, 'existsSync').and.returnValues(true, false);
      spyOn(fs, 'statSync').and.returnValue(obj);
      spyOn(fs, 'readdirSync').and.returnValue(['schema1.js', 'schema.txt', 'dir', 'schema2.js']);
    });

    it('traverse directory and collects schemas', function () {
      mod = new ApplicationModule(appInterface);
      expect(mod.loadSchema.calls.count()).toBe(2);
      expect(mod.loadSchema).toHaveBeenCalledWith('schema1');
      expect(mod.loadSchema).toHaveBeenCalledWith('schema2');
      expect(mod.loadSchemas()).toBe(false);
    });
  });

  describe('#loadRoutes', function () {
    var appInterface;
    var loadedRoutes;
    var routeModule = {};

    beforeEach(function () {
      loadedRoutes = {};
      appInterface = new AppInterface();
      spyOn(Module.prototype, 'require').and.returnValue(routeModule);
      spyOn(ApplicationModule.prototype, 'loadApi');
      spyOn(ApplicationModule.prototype, 'loadSchemas');
      spyOn(ApplicationModule.prototype, 'setupModuleRoutes').and.callFake((route, object) => loadedRoutes[route] = object);
      spyOn(ApplicationModule.prototype, 'loadRoutes').and.callThrough();
    });

    it('correctly loads routes', function () {
      var mod = new ApplicationModule(appInterface);
      expect(mod.setupModuleRoutes).toHaveBeenCalled();
      expect(loadedRoutes).toEqual({
        '/:param1/ns1': routeModule,
        '/:param1/ns1/:param2/ns2': routeModule,
        '/:param1/ns1/:param2': routeModule,
        '/ns1/ns2': routeModule
      });
    });

    it('accepts custom directory', function () {
      spyOn(fs, 'existsSync').and.returnValue(false);
      var mod = new ApplicationModule(appInterface);
      expect(mod.setupModuleRoutes).not.toHaveBeenCalled();
      expect(loadedRoutes).toEqual({});
    });
  });
});
