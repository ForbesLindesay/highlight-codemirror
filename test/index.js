'use strict';

var fs = require('fs');
var rimraf = require('rimraf').sync;
var it = require('testit');
var Promise = require('promise');
var request = Promise.denodeify(require('request'));
var CodeMirror = require('../');

rimraf(__dirname + '/output');
fs.mkdirSync(__dirname + '/output');

var modes = [];
var sources = {};
it('download the test cases', function () {
  return request('http://codemirror.net/mode/index.html').then(function (res) {
    var regex = /href="([a-zA-Z0-9]+)\/?(?:index.html)?"/g;
    var captures;
    while (captures = regex.exec(res.body.toString())) {
      modes.push(captures[1]);
    }
    return Promise.all(modes.map(function (mode) {
      return request('http://codemirror.net/mode/' + mode + '/index.html').then(function (res) {
        var src = res.body.toString().replace(/(.|\n)*<textarea[^>]*>/, '').replace(/<\/textarea[^>]*>(.|\n)*/, '');
        sources[mode] = src.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      });
    }));
  });
});

it('can handle all modes', function () {
  modes.forEach(function (name) {
    CodeMirror.loadMode(name);
  });
  modes.forEach(function (name) {
    var options = {name: name};
    if (name === 'gas') options.architecture = 'ARMv6';
    var html = CodeMirror.highlight(sources[name], options);
    console.log('v ' + name);
    fs.writeFileSync(__dirname + '/output/' + name + '.html', html, 'utf8');
  });
})
