"use strict"
var {MongoClient,ObjectID} = require('mongodb');
var assert = require('assert');
var log4js = require('log4js');

var logger = log4js.getLogger();

class MongoDb {
  constructor(host, port, db, user, pw){
    return new Promise((done, fail) => {
      var auth = (user && pw) ? (user+':'+pw+'@') : '';
      port = port || 27017;

      MongoClient.connect(`mongodb://${auth}${host}:${port}/${db}`, (err, db) => {
        assert.equal(null, err);
        this._connect = db;
        done(this);
      })
    });
  }
  convQuery(query){
    try{
      if(query.hasOwnProperty('_id')){
        if(query['_id']['$in']){
          query['_id']['$in'] = query['_id']['$in'].map((tId) => ObjectID(tId));
        }else{
          query['_id'] = ObjectID(query['_id']);
        }
      }
    }catch(e){
      logger.error(e.message);
    }
    return query;
  }
  insert(collect, doc, options){
    return new Promise((done, fail) => {
      if(this._connect && doc){
        var coll = this._connect.collection(collect);
        coll[(Array.isArray(doc) ? 'insertMany' : 'insert')](doc, options, (err, info) => {
          err && logger.error(err)
          assert.equal(null, err);
          //logger.info(result);
          done(info);
        });
      }else{
        fail();
      }
    });
  }
  remove(collect, query, options){
    return new Promise((done, fail) => {
      if(this._connect && query){
        var coll = this._connect.collection(collect);
        var ret = coll.removeMany(query, options);
        // conver object id
        this.convQuery(query);
        
        done();
      }else{
        fail();
      }
    });
  }
  findAndModify(collect, query, doc, options){
    return new Promise((done, fail) => {
      if(this._connect && query && doc){
        var coll = this._connect.collection(collect);
        //this.convQuery(query);
        options = options || {};
        coll.findOneAndUpdate(query, doc, options).then((data) => {
          done(data);
        }).catch((e) => {
          fail(e);
        });
      }else{
        fail();
      }
    });
  }
  upSert(collect, query, doc, options){
    return new Promise((done, fail) => {
      if(this._connect && doc){
        var coll = this._connect.collection(collect);
        // conver object id
        this.convQuery(query);
        
        options = options || {};
        options.w = 1;
        options.upsert = true;
        
        coll[(Array.isArray(doc) ? 'updateMany' : 'update')](query, doc,options, (err, info) => {
          err && logger.error(err)
          assert.equal(null, err);
          done(info);
        });
      }else{
        fail();
      }
    })
  }
  query(collect, query, options){
    //logger.info('test')
    return new Promise((done, fail) => {
      if(this._connect){
        var coll = this._connect.collection(collect);
        // conver object id
        this.convQuery(query);
        
        //logger.info(coll);
        coll.find(query, options).toArray((err, info) => {
          assert.equal(null, err);
          done(info);
        });
      }else{
        fail();
      }
    });
  }
  buildIndex(collect, keys, reserve, extras){
    return new Promise((done, fail) => {
      if(this._connect){
        var coll = this._connect.collection(collect);
        var index = {};
        Array.isArray(keys) ? keys.map((key) => {index[key]= (reserve ? -1 : 1)}) : (index[keys]=(reserve ? -1 : 1));
        return callback ? coll.ensureIndex(index, extras, (err, indexName) => {
          assert.equal(null, err);
          console.log('buildIndex:'+indexName)
          done(indexName);
        }) : coll.ensureIndex(index, extras);
      }else{
        fail();
      }
    });
  }
  update(collect, query, doc){
    return new Promise((done, fail) => {
      if(this._connect){
        // conver object id
        this.convQuery(query);
        var coll = this._connect.collection(collect);
        return coll.updateOne(query, doc, {w:1}).then((info) => {
          done(info);
        }).catch((e) => {
          fail(e)
        });
      }else{
        fail();
      }
    });
  }
  checkIndex(collect, option){
    return new Promise((done, fail) => {
      if(this._connect){
        var coll = this._connect.collection(collect);
        return coll.indexInformation(option || {full:true}, (err, info) => {
          assert.equal(null, err);
          done(info);
        });
      }else{
        fail();
      }
    });
  }
}
module.exports = MongoDb;
