# highlight-codemirror

A syntax highlighter built to run in node and consume CodeMirror modes.

[![Build Status](https://img.shields.io/travis/ForbesLindesay/highlight-codemirror/master.svg)](https://travis-ci.org/ForbesLindesay/highlight-codemirror)
[![Dependency Status](https://img.shields.io/gemnasium/ForbesLindesay/highlight-codemirror.svg)](https://gemnasium.com/ForbesLindesay/highlight-codemirror)
[![NPM version](https://img.shields.io/npm/v/highlight-codemirror.svg)](http://badge.fury.io/js/highlight-codemirror)

## API

### highlight(source, mode)

The source should be a string of code to highlight. The mode should be either the name of a mode (as a string) or an object (allowing you to specify other options).

```javascript
var highlight = require('highlight-codemirror');

var html = highlight('assert(typeof "foo" === "string")', 'javascript');
// => '<span class="cm-variable">assert</span>(<span class="cm-keyword">typeof</span> <span class="cm-string">&quot;foo&quot;</span> <span class="cm-operator">===</span> <span class="cm-string">&quot;string&quot;</span>)'
```

### highlight.loadMode(name);

Loading modes is synchronous, so you may wish to pre-populate the cache bu loading the mode up front.  You can also load custom modes by passing an absolute path to a JavaScript file.  e.g. the null mode might look like:

/custom-null-mode.js

```js
var CodeMirror = require('codemirror');

// Minimal default mode.
CodeMirror.defineMode("custom-null", function() {
  return {token: function(stream) {stream.skipToEnd();}};
});
```

You could then do:

```js
highlight.loadMode('/custom-null-mode.js');
assert(highlight('This is not really a programming language', 'custom-null') === 'This is not really a programming language');
```

## License

MIT
