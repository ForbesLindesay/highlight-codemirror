'use strict';

var assert = require('assert');
var fs = require('fs');
var cp = require('child_process');
var rimraf = require('rimraf').sync;
var it = require('testit');
var Promise = require('promise');
var request = Promise.denodeify(require('request'));
var highlight = require('../');

rimraf(__dirname + '/output');
fs.mkdirSync(__dirname + '/output');

function noop() {}
if (process.argv[2] === 'silent') {
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
}

var modes = [];
var results = {};
it('download the test cases', function () {
  return request('http://codemirror.net/mode/index.html').then(function (res) {
    var regex = /href="([a-zA-Z0-9]+)\/?(?:index.html)?"/g;
    var captures;
    while (captures = regex.exec(res.body.toString())) {
      if (['django', 'dylan'].indexOf(captures[1]) === -1)
        modes.push(captures[1]);
    }
    return Promise.all(modes.map(function (mode) {
      return request('http://codemirror.net/mode/' + mode + '/index.html').then(function (res) {
        var src = res.body.toString().replace(/(.|\n)*<textarea[^>]*>/, '').replace(/<\/textarea[^>]*>(.|\n)*/, '');
        results[mode] = testMode(mode, src.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
      });
    }));
  });
});

it('can handle all modes', function () {
  var failed = false;
  return Promise.all(modes.sort().map(function (name) {
    return results[name].then(function (code) {
      if (code === 0) {
        return '    - ' + name;
      } else {
        failed = true;
        return '    x ' + name;
      }
    });
  })).then(function (results) {
    results.forEach(function (res) {
      console.log(res);
    });
    if (failed) {
      throw new Error('Some modes failed');
    }
  });
});

it('can handle custom modes', function () {
  highlight.loadMode(require.resolve('./custom-null'));
  assert(highlight('This is not really a programming language', 'custom-null') === 'This is not really a programming language');
});

function testMode(name, source) {
  return new Promise(function (resolve, reject) {
    var mode = {name: name, source: source};
    cp.fork(require.resolve('./test-mode.js'))
      .once('error', reject)
      .once('exit', resolve)
      .send(mode);
  });
}
