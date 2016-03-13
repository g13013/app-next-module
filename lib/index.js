"use strict";

var fs = require('fs');
var path = require('path');
var request = require('co-request');
var EventEmitter = require('events');
var FsNode = require('fs-node');

const HTTP_METHODS = ['get', 'head', 'post', 'put', 'del', 'delete'];
const JS_EXT_RE = /\.js$/;
const PARAM_RE = /^_(.*?)_$/;

/**
 * Base class for app-next modules
 */
class ApplicationModule extends EventEmitter {
  constructor (app, config) {
    super();

    if (!app) {
      throw new TypeError('ApplicationModule expects an application interface');
    }

    this.app = app;
    this.config = config || {};
    this.api = {
      module: this
    };

    this.logger.info('loading api');
    this.loadApi();

    this.logger.info('loading schemas');
    this.loadSchemas();

    this.logger.info('loading routes');
    this.loadRoutes();
  }

  start () {
    // TODO override me
  }

  get validator () {
    return this.app.Joi;
  }

  get Joi () {
    return this.app.Joi;
  }

  get request () {
    return request;
  }

  get schemas () {
    return this.app.schemas;
  }

  get models () {
    return this.app.models;
  }

  get descriptor () {
    return this.app.moduleDescriptor;
  }

  get logger () {
    return this.app.logger;
  }

  get router () {
    return this.app.router;
  }

  get libDir () {
    var main = this.descriptor.packageInfo.main || 'index.js';
    return path.dirname(path.resolve(this.descriptor.path, main));
  }

  get apiDir () {
    return `${this.libDir}/api`;
  }

  get routesDir () {
    return `${this.libDir}/routes`;
  }

  get schemasDir () {
    return `${this.libDir}/schemas`;
  }

  getSchema () {
    return this.app.getSchema.apply(this.app, arguments);
  }

  model () {
    var model = this.app.model.apply(this.app, arguments);
    model.module = this; // provide module instance on models
    return model;
  }

  setupRouteHandler (route, handler, method, validate) {
    if (typeof handler !== 'function') {
      return
    }

    if (handler.constructor.name !== 'GeneratorFunction') {
      return handler.call(this, this.router);
    }

    let routeObj = {
      path: route,
      handler: handler,
      method: method && method.toUpperCase() || 'GET'
    }

    var validateType = typeof validate;
    if (validateType === 'object') {
      routeObj.validate = validate;
    } else if (validateType === 'function') {
      routeObj.validate = validate.call(this, this.validator);
    }

    return this.router.route(routeObj);
  }

  setupModuleRoutes (route, mod) {
    this.setupRouteHandler(route, mod, 'GET', mod.validate);

    for (let idx in HTTP_METHODS) {
      let method = HTTP_METHODS[idx];
      this.setupRouteHandler(route, mod[method], method, mod[`${method.toLowerCase()}Validate`]);
    }
  }

  serializeRoute (name) {
    let params = PARAM_RE.exec(name);
    if (params) {
      return ':' + params[1];
    }

    return name;
  }

  loadApi () {
    if (!fs.existsSync(this.apiDir)) {
      return false;
    }

    let files = new FsNode(this.apiDir);
    for (let file of files) {
      if (file.extname === '.js') {
        let api = require(file.path);

        api.module = this;
        api.api = this.api;
        api.models = this.models;
        api.logger = this.logger;

        this.logger.debug(`loading api ${file.basename.camelized}`);
        // unsure read only
        Object.defineProperty(this.api, file.basename.camelized, {
          configurable: false,
          enumarable: true,
          get() {
            return api;
          }
        });

      }
    }

  }


  loadRoutes (dir, baseRoute) {
    baseRoute = baseRoute || '';
    dir = dir || this.routesDir;

    if (!fs.existsSync(dir)) {
      return false;
    }

    var tree = fs.readdirSync(dir);
    for (let i = 0; i < tree.length; i++) {
      let name = tree[i].replace(JS_EXT_RE, '');
      let routePath = path.resolve(dir, tree[i]);

      if (fs.statSync(routePath).isDirectory()) {
        this.loadRoutes(routePath, `${baseRoute}/${this.serializeRoute(name)}`);
        continue;
      }

      if (name === tree[i]) {
        continue;
      }

      let route = require(routePath);
      if (name === 'index') {
        this.setupModuleRoutes(`${baseRoute}`, route);
        continue;
      }

      this.setupModuleRoutes(`${baseRoute}/${this.serializeRoute(name)}`, route);
    }
  }

  loadSchemas () {
    if (!fs.existsSync(this.schemasDir)) {
      return false;
    }

    var tree = fs.readdirSync(this.schemasDir);
    for (let i = 0; i < tree.length; i++) {
      let name = tree[i].replace(JS_EXT_RE, '');
      let schemPath = path.resolve(this.schemasDir, tree[i]);

      if (name === tree[i] || fs.statSync(schemPath).isDirectory()) {
        continue;
      }

      try {
        this.loadSchema(name);
      } catch(err) {
        this.logger.error(`Could not load schema "${name.classified}" / ${err}`);
        this.logger.debug(err.stack);
      }
    }
  }

  loadSchema(name) {
    let schema = this.app.getSchema(name);
    if (schema) {
      return schema;
    }

    schema = require(`${this.schemasDir}/${name}`);
    if (typeof schema === 'function') {
      schema = schema.call(this, this.app.Schema);

      if (!schema) {
        throw new TypeError(
          `Invalid schema type "${typeof schema}" returned for model ${name.classified}`);
      }
    }

    return this.model(name, schema);
  }
}

module.exports = ApplicationModule;
