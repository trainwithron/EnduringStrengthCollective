// The Canadian Society for Exercise Physiology's PAR-Q+ — a real,
// standardized industry health-screening tool, reproduced verbatim
// (not paraphrased) per this app's existing intake research.
export const PAR_Q_QUESTIONS: string[] = [
  "Has your doctor ever said that you have a heart condition and that you should only perform physical activity recommended by a doctor?",
  "Do you feel pain in your chest at rest, during your daily activities of living, or when you do physical activity?",
  "Do you lose balance because of dizziness or have you lost consciousness in the last 12 months? (Please answer NO if your dizziness was associated with over-breathing, including during vigorous exercise.)",
  "Have you ever been diagnosed with another chronic medical condition (other than heart disease or high blood pressure)?",
  "Are you currently taking prescribed medications for a chronic medical condition?",
  "Do you currently have (or have had within the past 12 months) a bone, joint, or soft tissue problem that could be made worse by becoming more physically active?",
  "Has your doctor ever said that you should only do medically supervised physical activity?",
];

export interface ParQAnswer {
  question: string;
  answer: boolean;
}
