// Shared document data contracts, independent of the DOCX renderer.
export interface PlanDocxSection {
  heading: string;
  content: string;
}

export interface PlanDocxChart {
  key?: string;
  title: string;
  png: string;
  width: number;
  height: number;
  targetSection?: string;
  sourceNote?: string;
}

export interface PlanDocxEvidenceSource {
  id: string;
  title: string;
  publisher: string;
  checkedAt: string;
  url: string;
  claim?: string;
}
