import type { LlmPlanner } from '../../domain/context/llm-planner.port';
import type {
  RetrievedSection,
  SectionRetriever,
  SectionSearchInput,
} from '../../domain/context/section-retriever.port';
import { PlanningPipeline } from './planning-pipeline';

/** Builds a `RetrievedSection`; override per test. */
export function makeRetrieved(
  overrides: Partial<RetrievedSection> = {},
): RetrievedSection {
  return {
    sectionId: 'sec-1',
    documentId: 'doc-1',
    documentTitle: 'Doc',
    title: 'Section',
    content: 'Section content',
    inBoundDocument: true,
    matched: true,
    ...overrides,
  };
}

/** In-memory `SectionRetriever`: returns `sections`, or throws `error`. */
export class FakeSectionRetriever implements SectionRetriever {
  readonly calls: SectionSearchInput[] = [];

  constructor(
    public sections: RetrievedSection[] = [],
    public error: Error | null = null,
  ) {}

  search(input: SectionSearchInput): Promise<RetrievedSection[]> {
    this.calls.push(input);
    return this.error
      ? Promise.reject(this.error)
      : Promise.resolve(this.sections);
  }
}

/** A pipeline over `planner` that retrieves nothing unless told otherwise. */
export function makePipeline(
  planner: LlmPlanner,
  retriever: SectionRetriever = new FakeSectionRetriever(),
  maxInputChars?: number,
): PlanningPipeline {
  return new PlanningPipeline(planner, retriever, maxInputChars);
}
