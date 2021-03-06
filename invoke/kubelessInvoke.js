'use strict';

const _ = require('lodash');
const BbPromise = require('bluebird');
const path = require('path');
const request = require('request');
const helpers = require('../lib/helpers');

class KubelessInvoke {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'invoke:invoke': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.invokeFunction)
        .then(this.log),
    };
  }

  getData() {
    let result = null;
    try {
      if (!_.isEmpty(this.options.data)) {
        try {
          // Try to parse data as JSON
          result = {
            body: JSON.parse(this.options.data),
            json: true,
          };
        } catch (e) {
          // Assume data is a string
          result = {
            body: this.options.data,
          };
        }
      } else if (this.options.path) {
        const absolutePath = path.isAbsolute(this.options.path) ?
          this.options.path :
          path.join(this.serverless.config.servicePath, this.options.path);
        if (!this.serverless.utils.fileExistsSync(absolutePath)) {
          throw new this.serverless.classes.Error('The file you provided does not exist.');
        }
        result = {
          body: this.serverless.utils.readFileSync(absolutePath),
          json: true,
        };
      }
    } catch (e) {
      throw new this.serverless.classes.Error(
        `Unable to parse data given in the arguments: \n${e.message}`
      );
    }
    return result;
  }

  validate() {
    helpers.validateEnv();
    // Parse data to ensure it has a correct format
    this.getData();
    const unsupportedOptions = ['stage', 'region', 'type'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  invokeFunction() {
    const f = this.options.function;
    this.serverless.cli.log(`Calling function: ${f}...`);

    return new BbPromise((resolve, reject) => {
      const requestData = this.getData();
      const url = `${process.env.KUBE_API_URL}/api/v1/proxy/namespaces/default/services/${f}/`;
      const parseReponse = (err, response) => {
        if (err) {
          reject(new this.serverless.classes.Error(err.message, err.statusCode));
        } else {
          if (response.statusCode !== 200) {
            reject(new this.serverless.classes.Error(response.statusMessage, response.statusCode));
          }
          resolve(response);
        }
      };
      if (_.isEmpty(requestData)) {
        // There is no data to send, sending a GET request
        request.get(Object.assign(helpers.getMinikubeCredentials(), { url }), parseReponse);
      } else {
        // Sending request data with a POST
        request.post(
          Object.assign(
            helpers.getMinikubeCredentials(),
            { url },
            requestData
          ),
          parseReponse
        );
      }
    });
  }
  log(response) {
    if (this.options.log) {
      console.log('--------------------------------------------------------------------');
      console.log(response.body);
    }
    return BbPromise.resolve();
  }
}

module.exports = KubelessInvoke;
