  var document = selectDocument(), restore = saveEditState(document);
  var applied = [], results = [], failed = null, skipped = [], warnings = [], libraryChanged = false;

  try {
    for (var opIndex = 0; opIndex < __ops.length; opIndex++) {
      var op = __ops[opIndex];
      try {
        var result = applyLibraryOp(op);
        applied.push(op);
        results.push({ op: op, result: result });
      } catch (error) {
        failed = { op: op, error: String(error && error.message ? error.message : error) };
        for (var skippedIndex = opIndex + 1; skippedIndex < __ops.length; skippedIndex++) skipped.push(__ops[skippedIndex]);
        break;
      }
    }
  } finally {
    if (libraryChanged) {
      var warning = restore();
      if (warning) {
        warnings.push(warning);
      }
    }
  }

  return serialize({ applied: applied, results: results, failed: failed, skipped: skipped, warnings: warnings });
  })();
