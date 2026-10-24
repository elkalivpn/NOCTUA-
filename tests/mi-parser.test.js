"use strict";
/* NOCTUA — tests del parser GDB/MI (docs/DESIGN-debugger.md, §4 y §9).
   Transcripciones MI como fixtures inline: sin gdb, sin I/O (R4). */
const test = require("node:test");
const assert = require("node:assert");
const {
  parseMiLine, parseResultSequence, unescapeCString, miEscape, miPath, miArg
} = require("../src/main/debugger/mi-parser");

test("parser: (gdb) y líneas desconocidas", () => {
  assert.equal(parseMiLine("(gdb)").type, "ready");
  assert.equal(parseMiLine("basura sin formato").type, "unknown");
});

test("parser: stream records con escapado C", () => {
  const a = parseMiLine('~"warning: hola\\n"');
  assert.equal(a.type, "stream");
  assert.equal(a.stream, "console");
  assert.equal(a.data, "warning: hola\n");
  const b = parseMiLine('@"salida del inferior"');
  assert.equal(b.stream, "target");
  assert.equal(b.data, "salida del inferior");
  const c = parseMiLine('&"[dbx] log interno"');
  assert.equal(c.stream, "log");
  assert.equal(c.data, "[dbx] log interno");
});

test("parser: result record con token, tuplas y listas anidadas", () => {
  const r = parseMiLine('12^done,bkpt={number="1",addr="0x00401000",file="main.c",line="10"},time={wall="1"}');
  assert.equal(r.type, "result");
  assert.equal(r.token, 12);
  assert.equal(r.resultClass, "done");
  assert.equal(r.results.bkpt.number, "1");
  assert.equal(r.results.bkpt.file, "main.c");
  assert.equal(r.results.time.wall, "1");
  const run = parseMiLine("5^running");
  assert.equal(run.resultClass, "running");
  assert.deepEqual(run.results, {});
  assert.equal(parseMiLine("^done").token, null);
});

test("parser: error y registros async exec/notify", () => {
  const e = parseMiLine('13^error,msg="No symbol table is loaded",code="undefined-command"');
  assert.equal(e.resultClass, "error");
  assert.equal(e.results.msg, "No symbol table is loaded");
  assert.equal(e.results.code, "undefined-command");
  const st = parseMiLine('*stopped,reason="breakpoint-hit",bkptno="1",frame={addr="0x4011a9",func="main",args=[],file="main.c",fullname="/tmp/main.c",line="10"}');
  assert.equal(st.type, "exec");
  assert.equal(st.asyncClass, "stopped");
  assert.equal(st.results.reason, "breakpoint-hit");
  assert.equal(st.results.frame.fullname, "/tmp/main.c");
  assert.equal(st.results.frame.args.length, 0);
  assert.equal(parseMiLine('*stopped,reason="exited-normally"').results.reason, "exited-normally");
  const nt = parseMiLine('=thread-group-exited,exit-code="0"');
  assert.equal(nt.type, "notify");
  assert.equal(nt.results["exit-code"], "0");
  assert.equal(parseMiLine('*running,thread-id="all"').results["thread-id"], "all");
});

test("parser: listas de resultados (stack, variables)", () => {
  const s = parseResultSequence('stack=[frame={level="0",func="main"},frame={level="1",func="__libc_start_main"}]');
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack[0].frame.func, "main");
  assert.equal(s.stack[1].frame.level, "1");
  const v = parseResultSequence('variables=[{name="argc",arg="1",value="1"},{name="ptr",arg="0"}]');
  assert.equal(v.variables.length, 2);
  assert.equal(v.variables[0].name, "argc");
  assert.equal(v.variables[1].value, undefined);
});

test("parser: escapado MI de rutas y argumentos (R5)", () => {
  assert.equal(miPath('/tmp/a b"c\\d'), '"/tmp/a b\\"c\\\\d"');
  assert.equal(miArg(["-o", "dos palabras"]), '"-o" "dos palabras"');
  assert.equal(unescapeCString("a\\nb\\tc\\\\d"), "a\nb\tc\\d");
});
