export type Source = { name: string; text: string };
export type EvidenceFile = Source & { questionIndex?: number };
export type Question = { example?: string; prompt: string; source: string; quote: string };
export type Group = { name: string; questions: Question[] };
export type Notice = {
  title: string;
  url: string;
  sources: string[];
  unread: string[];
  groups: Group[];
};
export type Finding = {
  question: string;
  status: string;
  reason: string;
  evidence: string;
  next: string;
};
export type Diagnosis = { priority: string; findings: Finding[] };
