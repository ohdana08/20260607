"use client";
import type { FormEvent } from "react";
import type { Goal, Video } from "@/lib/operations/domain";

export function NumberField({
  name,
  label,
  value,
  optional: nullable = false,
}: {
  name: string;
  label: string;
  value: number | null;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        min="0"
        step="1"
        required={!nullable}
        defaultValue={value ?? ""}
        placeholder={nullable ? "미확인" : "0"}
      />
    </label>
  );
}
export function GoalForm({
  goal,
  submit,
  busy,
}: {
  goal: Goal;
  submit: (e: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  return (
    <form onSubmit={submit}>
      <div className="ops-fields">
        <label>
          시작일
          <input
            name="startDate"
            type="date"
            defaultValue={goal.startDate}
            required
          />
        </label>
        <label>
          마감일
          <input
            name="deadline"
            type="date"
            defaultValue={goal.deadline}
            required
          />
        </label>
        <NumberField
          name="targetKrw"
          label="목표 매출 (원)"
          value={goal.targetKrw}
        />
        <NumberField
          name="plannedVideos"
          label="계획 영상 (편)"
          value={goal.plannedVideos}
        />
        <NumberField
          name="wordPriceKrw"
          label="역산 Word 가격 (원)"
          value={goal.wordPriceKrw}
        />
      </div>
      <button disabled={busy}>목표 저장</button>
    </form>
  );
}
export function VideoForm({
  video,
  date,
  submit,
  busy,
}: {
  video?: Video;
  date: string;
  submit: (e: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  return (
    <form onSubmit={submit} className="ops-video-form">
      <input type="hidden" name="id" value={video?.id ?? ""} />
      <div className="ops-fields">
        <label>
          영상 제목
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={video?.title ?? ""}
          />
        </label>
        <label>
          게시 예정일
          <input name="plannedDate" type="date" required defaultValue={date} />
        </label>
        <label>
          상품
          <select name="product" defaultValue={video?.product ?? "word"}>
            <option value="word">Word</option>
            <option value="bundle">묶음</option>
            <option value="presentation">발표 추가</option>
          </select>
        </label>
        <label>
          상태
          <select name="status" defaultValue={video?.status ?? "planned"}>
            <option value="planned">계획</option>
            <option value="ready">편집 완료</option>
            <option value="published">게시 완료</option>
          </select>
        </label>
        <label>
          게시 주소
          <input
            name="url"
            type="url"
            maxLength={500}
            placeholder="https://www.youtube.com/shorts/…"
            defaultValue={video?.url ?? ""}
          />
        </label>
        <NumberField
          name="views24h"
          label="24시간 조회수"
          value={video?.views24h ?? null}
          optional
        />
        <NumberField
          name="views72h"
          label="72시간 조회수"
          value={video?.views72h ?? null}
          optional
        />
      </div>
      <button disabled={busy}>영상 저장</button>
    </form>
  );
}
