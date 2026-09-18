import test from "node:test";
import assert from "node:assert/strict";
import { extractFormHeadings } from "../lib/plan/formHeadings.ts";

test("HWPX remnants and duplicate cover headings preserve official section order", () => {
  assert.deepEqual(
    extractFormHeadings(
      [
        "1. 문제 인식",
        "2. 실현 가능성",
        "1. 문제 인식 및 고객의 불편",
        "<hp:lineBreak/>2. 실현 가능성",
        "2-1. 개발 계획",
        "2026.09.17",
        "1. Introduction",
      ].join("\n"),
    ),
    ["1. 문제 인식 및 고객의 불편", "2. 실현 가능성", "2-1. 개발 계획"],
  );
});
test("square headings use the longest original spelling without merging distinct topics", () => {
  assert.deepEqual(
    extractFormHeadings("□ 개요\n□ 창업 아이템 개요\n■ 팀 구성\n설명문\n"),
    ["□ 창업 아이템 개요", "■ 팀 구성"],
  );
});
test("empty, date and overlong lines never become official headings", () => {
  assert.deepEqual(
    extractFormHeadings("\n00.00 ~ 00.00\n1. " + "가".repeat(60)),
    [],
  );
});
