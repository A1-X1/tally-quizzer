// Prompts for people who generate quizzes in their own AI chat (Claude, ChatGPT,
// Gemini) and import the CSV. The multiple-choice prompt is the original from the brief.

import templateCsv from '../../samples/template.csv?raw'

export const CHOICE_PROMPT = `Create a multiple-choice quiz as raw CSV from the material I provide.

Topic: [TOPIC]
Number of questions: [NUMBER]
Difficulty: [EASY / MEDIUM / HARD / MIXED]
Source material: [PASTE NOTES OR ATTACH FILES]

Output only the CSV, in a single code block or as a downloadable .csv file. Do not add commentary.

Use exactly this header:
question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic

Rules:
- Every question must have exactly five distinct, non-empty options.
- type must be "single" or "multi".
- A single question must have exactly one correct letter.
- A multi question must have one or more correct letters, separated by semicolons, for example A;C;E.
- Use a mix of single and multi questions unless told otherwise.
- marks must be a positive number. Use 1 for simple recall and more for multi-step or multi-answer questions.
- Wrap any field containing a comma, quote, or line break in double quotes. Escape a double quote by doubling it.
- Write mathematics in LaTeX using $...$ and code in backticks.
- Every explanation must say why the correct answer is right and address the main misconception.
- topic must be a short subtopic name, used consistently.
- Base every question on the source material. Make distractors plausible and avoid "all of the above" or "none of the above".
- Vary the position of the correct answers.
- Check every row against these rules before responding.

Follow the structure of this example:
${templateCsv.trim()}`

const WRITTEN_EXAMPLE = `question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic,model_answer,mark_scheme
"Which connective is false only when the antecedent is true and the consequent is false?",Conjunction,Disjunction,Implication,Biconditional,Exclusive or,single,C,1,"An implication P → Q fails only when P is true and Q is false.",Propositional logic,,
"Explain why $P \\to Q$ and its contrapositive are logically equivalent.",,,,,,written,,3,"Both are false in exactly one case.",Propositional logic,"$P \\to Q$ is false only when P is true and Q is false. The contrapositive $\\neg Q \\to \\neg P$ is false only when $\\neg Q$ is true and $\\neg P$ is false, which is the same assignment. They have the same truth table, so they are equivalent.","[1] States when $P \\to Q$ is false (P true, Q false); [1] States when $\\neg Q \\to \\neg P$ is false and that it is the same case (accept: a correct truth table); [1] Concludes they always share a truth value, so they are equivalent (do not accept: ""they mean the same thing"" with no reason)"`

export const WRITTEN_PROMPT = `Create a quiz as raw CSV from the material I provide. Include written-answer questions.

Topic: [TOPIC]
Number of questions: [NUMBER]
Question format: [MIXED / WRITTEN ONLY]
Difficulty: [EASY / MEDIUM / HARD / MIXED]
Source material: [PASTE NOTES OR ATTACH FILES]

Output only the CSV, in a single code block or as a downloadable .csv file. Do not add commentary.

Use exactly this header:
question,option_a,option_b,option_c,option_d,option_e,type,correct,marks,explanation,topic,model_answer,mark_scheme

Rules for every question:
- type must be "single", "multi" or "written". For MIXED use about two thirds single/multi and one third written; for WRITTEN ONLY use only "written".
- marks must be a positive number.
- Wrap any field containing a comma, quote, or line break in double quotes. Escape a double quote by doubling it.
- Write mathematics in LaTeX using $...$ and code in backticks.
- topic must be a short subtopic name, used consistently.
- Base every question, answer and mark scheme on the source material only. Do not add facts from elsewhere.

Rules for single and multi questions:
- Exactly five distinct, non-empty options; plausible distractors; no "all of the above" or "none of the above".
- correct holds the right letters, separated by semicolons (single: exactly one). Leave model_answer and mark_scheme empty.

Rules for written questions:
- Leave option_a to option_e and correct empty.
- model_answer is a full-mark answer of 2 to 6 sentences.
- mark_scheme lists 1 to 6 independent points as [marks] description, separated by semicolons, for example: [2] Names the mitochondrion; [1] Mentions ATP. Each point is one specific, checkable idea. Add (accept: ...) for acceptable alternatives and (do not accept: ...) for tempting wrong answers.
- marks equals the total of the mark_scheme points.

Check every row against these rules before responding.

Follow the structure of this example:
${WRITTEN_EXAMPLE}`
