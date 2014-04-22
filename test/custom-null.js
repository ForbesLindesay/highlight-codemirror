var CodeMirror = require('codemirror');

// Minimal default mode.
CodeMirror.defineMode("custom-null", function() {
  return {token: function(stream) {stream.skipToEnd();}};
});