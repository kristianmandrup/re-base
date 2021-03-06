module.exports = (function(){
  var Firebase = require('firebase');
  var $q = require('q'); // for timeout promise

  var baseUrl = '';
  var rebase;
  var firebaseRefs = {};
  var firebaseListeners = {};

  var optionValidators = {
    notObject(options){
      if(!_isObject(options)){
        _throwError(`The options argument must be an object. Instead, got ${options}`, 'INVALID_OPTIONS');
      }
    },
    context(options){
      this.notObject(options);
      if(!options.context || !_isObject(options.context)){
        this.makeError('context', 'object', options.context);
      }
    },
    state(options){
      this.notObject(options);
      if(!options.state || typeof options.state !== 'string'){
        this.makeError('state', 'string', options.state);
      }
    },
    then(options){
      this.notObject(options);
      if(typeof options.then === 'undefined' || typeof options.then !== 'function'){
        this.makeError('then', 'function', options.then);
      }
    },
    data(options){
      this.notObject(options);
      if(typeof options.data === 'undefined'){
        this.makeError('data', 'ANY', options.data);
      }
    },
    query(options){
      this.notObject(options);
      var validQueries = ['limitToFirst', 'limitToLast', 'orderByChild', 'orderByValue', 'orderByKey', 'orderByPriority', 'startAt', 'endAt', 'equalTo'];
      var queries = options.queries;
      for(var key in queries){
        if(queries.hasOwnProperty(key) && validQueries.indexOf(key) === -1){
          _throwError(`The query field must contain valid Firebase queries.  Expected one of [${validQueries.join(', ')}]. Instead, got ${key}`, 'INVALID_OPTIONS');
        }
      }
    },
    makeError(prop, type, actual){
      _throwError(`The options argument must contain a ${prop} property of type ${type}. Instead, got ${actual}`, 'INVALID_OPTIONS');
    }
  };

  function _toArray(snapshot){
    var arr = [];
    snapshot.forEach(function (childSnapshot){
      var val = childSnapshot.val();
      if(_isObject(val)){
        val.key = childSnapshot.key();
      }
      arr.push(val);
    });
    return arr;
  };

  function _isObject(obj){
    return Object.prototype.toString.call(obj) === '[object Object]' ? true : false;
  };

  function _throwError(msg, code){
    var err = new Error(`REBASE: ${msg}`);
    err.code = code;
    throw err;
  };

  function _validateBaseURL(url){
    var defaultError = 'Rebase.createClass failed.';
    var errorMsg;
    if(typeof url !== 'string'){
      errorMsg = `${defaultError} URL must be a string.`;
    } else if(!url || arguments.length > 1){
      errorMsg = `${defaultError} Was called with more or less than 1 argument. Expects 1.`;
    } else if(url.length === ''){
      errorMsg = `${defaultError} URL cannot be an empty string.`;
    } else if(url.indexOf('.firebaseio.com') === -1){
      errorMsg = `${defaultError} URL must be in the format of https://<YOUR FIREBASE>.firebaseio.com. Instead, got ${url}.`;
    }

    if(typeof errorMsg !== 'undefined'){
      _throwError(errorMsg, "INVALID_URL");
    }
  };

  function _validateEndpoint(endpoint){
    var defaultError = 'The Firebase endpoint you are trying to listen to';
    var errorMsg;
    if(typeof endpoint !== 'string'){
      errorMsg = `${defaultError} must be a string. Instead, got ${endpoint}`;
    } else if(endpoint.length === 0){
      errorMsg = `${defaultError} must be a non-empty string. Instead, got ${endpoint}`;
    } else if(endpoint.length > 768){
      errorMsg = `${defaultError} is too long to be stored in Firebase. It be less than 768 characters.`;
    } else if(/^$|[\[\]\.\#\$]/.test(endpoint)){
      errorMsg = `${defaultError} in invalid. Paths must be non-empty strings and can't contain ".", "#", "$", "[", or "]".`;
    }

    if(typeof errorMsg !== 'undefined'){
      _throwError(errorMsg, "INVALID_ENDPOINT");
    }
  };

  function _setState(newState){
    this.setState(newState);
  };

  function _returnRef(endpoint, method){
    var id = Date.now();
    return { endpoint, method, id };
  };

  // default timeout 2 secs
  function timeout(ref, eventType, timeOut = {period: 2000}) {
      var deferred = (timeOut.q || $q).defer();
      $timeout(function() {
          deferred.reject("TIMEOUT");
      }, timeOut.period)
      ref.once(eventType,
          function(data) {
              deferred.resolve(data);
          },
          function(error) {
              deferred.reject(error);
          }
      );
      return deferred.promise;
  }

  function _refOnce(value, options) {
    ref.once('value', (snapshot) => {
      var data = options.asArray === true ? _toArray(snapshot) : snapshot.val();
      options.then.call(options.context, data);
    }, (err) => {
      options.failure.call(options.context, err);
    });
  }


  function _fetch(endpoint, options){
    _validateEndpoint(endpoint);
    optionValidators.context(options);
    optionValidators.then(options);
    options.queries && optionValidators.query(options);
    var ref = new Firebase(`${baseUrl}/${endpoint}`);
    ref = _addQueries(ref, options.queries);

    if (options.timeout) {
      timeout(ref, 'value', options.timeout);
    } else {
      _refOnce(ref, 'value', options);
    }
  };

  function _firebaseRefsMixin(endpoint, invoker, ref){
    if(!_isObject(firebaseRefs[endpoint])){
      firebaseRefs[endpoint] = {
        [invoker]: ref.ref()
      };
      if (!firebaseListeners[endpoint]) {
        firebaseListeners[endpoint] = {}
      }
      if (!firebaseListeners[endpoint][invoker]) {
        firebaseListeners[endpoint][invoker] = {}
      }
    } else if(!firebaseRefs[endpoint][invoker]){
      firebaseRefs[endpoint][invoker] = ref.ref();
    }
  };

  function _addListener(endpoint, invoker, options, ref, id){
    ref = _addQueries(ref, options.queries);
    firebaseListeners[endpoint][invoker][id] = ref.on('value', (snapshot) => {
      var data = snapshot.val();
      data = data === null ? (options.asArray === true ? [] : {}) : data;
      if(invoker === 'listenTo'){
        options.asArray === true ? options.then.call(options.context, _toArray(snapshot)) : options.then.call(options.context, data);
      } else if(invoker === 'syncState'){
          data = options.asArray === true ? _toArray(snapshot) : data;
          options.reactSetState.call(options.context, {[options.state]: data});
          if(options.then && options.then.called === false){
            options.then.call(options.context);
            options.then.called = true;
          }
      } else if(invoker === 'bindToState') {
          var newState = {};
          options.asArray === true ? newState[options.state] = _toArray(snapshot) : newState[options.state] = data;
          _setState.call(options.context, newState);
      }
    });
  };

  function _bind(endpoint, options, invoker){
    _validateEndpoint(endpoint);
    optionValidators.context(options);
    invoker === 'listenTo' && optionValidators.then(options);
    invoker === 'bindToState' && optionValidators.state(options);
    options.queries && optionValidators.query(options);
    var ref = new Firebase(`${baseUrl}/${endpoint}`);
    _firebaseRefsMixin(endpoint, invoker, ref);
    var returnRef = _returnRef(endpoint, invoker)
    _addListener(endpoint, invoker, options, ref, returnRef.id);
    return  returnRef;
  };

  function _updateSyncState(ref, data, key){
    if(_isObject(data)) {
      for(var prop in data){
        _updateSyncState(ref.child(prop), data[prop], prop);
      }
    } else {
      ref.set(data);
    }
  };

  function _sync(endpoint, options){
    _validateEndpoint(endpoint);
    optionValidators.context(options);
    optionValidators.state(options);
    options.queries && optionValidators.query(options);
    if(_sync.called !== true){
      _sync.reactSetState = options.context.setState;
      _sync.called = true;
    } else {
      options.context.setState = _sync.reactSetState;
    }
    options.reactSetState = options.context.setState;
    options.then && (options.then.called = false);
    var ref = new Firebase(`${baseUrl}/${endpoint}`);
    _firebaseRefsMixin(endpoint, 'syncState', ref);
    var returnRef = _returnRef(endpoint, 'syncState')
    _addListener(endpoint, 'syncState', options, ref, returnRef.id);
    options.context.setState = function (data, cb) {
      for (var key in data) {
        if(data.hasOwnProperty(key)){
          if (key === options.state) {
            _updateSyncState.call(this, ref, data[key], key)
         } else {
            options.reactSetState.call(options.context, data, cb);
         }
        }
     }
    };
    return returnRef;
  };

  /*
    options:
      - data : any data structure
      - priority : number (optional)
      - then : function (optional)

    then function is called on set (passed an Error object on any error)
  */
  function _post(endpoint, options){
    _validateEndpoint(endpoint);
    optionValidators.data(options);
    var ref = new Firebase(`${baseUrl}/${endpoint}`);
    var operation = options.priority ? ref.setWithPriority : ref.set;
    var args = [options.data];
    options.priority || args.push(options.priority);
    options.then || args.push(options.then);

    operation.apply(this, args);
  };

  function _push(endpoint, options){
    _validateEndpoint(endpoint);
    optionValidators.data(options);
    var ref = new Firebase(`${baseUrl}/${endpoint}`);
    var returnEndpoint;
    if(options.then){
      returnEndpoint = ref.push(options.data, options.then);
    } else {
      returnEndpoint = ref.push(options.data);
    }
    return returnEndpoint;
  };

  function _addQueries(ref, queries){
    var needArgs = {
      limitToFirst: true,
      limitToLast: true,
      orderByChild: true,
      startAt: true,
      endAt: true,
      equalTo: true
    };
    for(var key in queries){
      if(queries.hasOwnProperty(key)){
        if(needArgs[key]) {
          ref = ref[key](queries[key]);
        } else {
          ref = ref[key]();
        }
      }
    }
    return ref;
  };

  function _removeBinding(refObj){
    _validateEndpoint(refObj.endpoint);
    if (typeof firebaseRefs[refObj.endpoint][refObj.method] === "undefined") {
      var errorMsg = `Unexpected value for endpoint. ${refObj.endpoint} was either never bound or has already been unbound.`;
      _throwError(errorMsg, "UNBOUND_ENDPOINT_VARIABLE");
    }
    firebaseRefs[refObj.endpoint][refObj.method].off('value', firebaseListeners[refObj.endpoint][refObj.method][refObj.id]);
    delete firebaseListeners[refObj.endpoint][refObj.method][refObj.id];
    if (!Object.keys(firebaseListeners[refObj.endpoint][refObj.method]).length) {
      delete firebaseRefs[refObj.endpoint][refObj.method];
    }
  };

  function _reset(){
    baseUrl = '';
    rebase = undefined;
    Object.getOwnPropertyNames(firebaseRefs).forEach(function (key) {
      Object.getOwnPropertyNames(firebaseRefs[key]).forEach(function (prop) {
        Object.getOwnPropertyNames(firebaseListeners[key][prop]).forEach(function (callback_id) {
            firebaseRefs[key][prop].off('value', firebaseListeners[key][prop][callback_id]);
        })
        delete firebaseRefs[key][prop];
        delete firebaseListeners[key][prop];
      })
    })
    firebaseRefs = {};
    firebaseListeners = {};
  };

  function _authWithPassword(credentials ,fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.authWithPassword(credentials, function(error, authData){
      return fn(error, authData);
    });
  }

  function _authWithCustomToken(token, fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.authWithCustomToken(token, function(error, authData){
      return fn(error, authData);
    });
 }

  function _authWithOAuthPopup(provider, fn, settings){
    settings = settings || {};
    var ref = new Firebase(`${baseUrl}`);
    return ref.authWithOAuthPopup(provider, function(error, authData) {
      return fn(error, authData);
     }, settings);
  }

  function _authWithOAuthToken(provider, token, fn, settings){
    settings = settings || {};
    var ref = new Firebase(`${baseUrl}`);
    return ref.authWithOAuthToken(provider, token, function(error, authData) {
      return fn(error, authData);
     }, settings);
  }

  function _authWithOAuthRedirect(provider, fn, settings){
    settings = settings || {};
    var ref = new Firebase(`${baseUrl}`);
    return ref.authWithOAuthRedirect(provider, function(error, authData) {
      return fn(error, authData);
     }, settings);
  }

  function _onAuth(fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.onAuth(fn);
  }

  function _offAuth(fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.offAuth(fn);
  }

  function _unauth(){
    var ref = new Firebase(`${baseUrl}`);
    return ref.unauth();
  }

  function _getAuth() {
    var ref = new Firebase(`${baseUrl}`);
    return ref.getAuth();
  }

  function _createUser(credentials, fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.createUser(credentials, function(error, authData) {
      return fn(error, authData);
    });
  };

  function _removeUser(credentials, fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.removeUser(credentials, function(error) {
      return fn(error);
    });
  };

  function _resetPassword(credentials, fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.resetPassword(credentials, function(error) {
      return fn(error);
    });
  };

  function _changePassword(credentials, fn){
    var ref = new Firebase(`${baseUrl}`);
    return ref.changePassword(credentials, function(error) {
      return fn(error);
    });
  };

  function init(){
    return {
      listenTo(endpoint, options){
        return _bind(endpoint, options, 'listenTo');
      },
      bindToState(endpoint, options){
        return _bind(endpoint, options, 'bindToState');
      },
      syncState(endpoint, options){
        return _sync(endpoint, options);
      },
      fetch(endpoint, options){
        _fetch(endpoint, options);
      },
      post(endpoint, options){
        _post(endpoint, options);
      },
      push(endpoint, options){
        return _push(endpoint, options);
      },
      removeBinding(endpoint){
        _removeBinding(endpoint, true);
      },
      reset(){
        _reset();
      },
      authWithPassword(credentials, fn){
        return _authWithPassword(credentials, fn);
      },
      authWithCustomToken(token, fn){
        return _authWithCustomToken(token, fn);
      },
      authWithOAuthPopup(provider, fn, settings){
        return _authWithOAuthPopup(provider, fn, settings);
      },
      authWithOAuthToken(provider, token, fn, settings){
        return _authWithOAuthToken(provider, token, fn, settings);
      },
      authWithOAuthRedirect(provider, fn, settings){
        return _authWithOAuthRedirect(provider, fn, settings);
      },
      onAuth(fn){
        return _onAuth(fn);
      },
      offAuth(fn){
        return _offAuth(fn);
      },
      unauth(fn){
        return _unauth();
      },
      getAuth() {
        return _getAuth();
      },
      createUser(credentials,fn) {
        return _createUser(credentials, fn);
      },
      removeUser(credentials,fn) {
        return _removeUser(credentials, fn);
      },
      resetPassword(credentials,fn) {
        return _resetPassword(credentials, fn);
      },
      changePassword(credentials,fn) {
        return _changePassword(credentials, fn);
      },
    }
  };

  return {
    createClass(url){
      if(rebase) {
        return rebase;
      }

      _validateBaseURL(url);
      baseUrl = url;
      rebase = init();

      return rebase
    }
  };
})();
