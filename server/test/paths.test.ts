import assert from "node:assert/strict";
import test from "node:test";
import { isInside } from "../src/tools/paths.js";

test("isInside accepts strict descendants only", () => {
    assert.equal(isInside("/a/b", "/a/b/c"), true);
    assert.equal(isInside("/a/b", "/a/b"), false);
    assert.equal(isInside("/a/b", "/a/bc"), false);
    assert.equal(isInside("/a/b", "/a"), false);
});
