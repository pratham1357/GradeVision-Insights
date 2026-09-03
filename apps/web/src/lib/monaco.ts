import type { ProgrammingLanguage } from "@gradevision/shared";

/** Maps GradeVision language identifiers to Monaco's `language` ids. */
const MONACO_LANGUAGE: Record<ProgrammingLanguage, string> = {
  C: "c",
  CPP: "cpp",
  JAVA: "java",
  PYTHON: "python",
  JAVASCRIPT: "javascript",
};

const LABEL: Record<ProgrammingLanguage, string> = {
  C: "C",
  CPP: "C++",
  JAVA: "Java",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
};

export function monacoLanguage(language: ProgrammingLanguage): string {
  return MONACO_LANGUAGE[language];
}

export function languageLabel(language: ProgrammingLanguage): string {
  return LABEL[language];
}
