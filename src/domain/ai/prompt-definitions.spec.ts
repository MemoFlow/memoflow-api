import {
  getPromptDefinition,
  PROMPT_DEFINITIONS,
  PROMPT_DEFINITIONS_V2,
  PROMPT_FEATURE_TYPES,
  SYSTEM_TEMPLATE_PLACEHOLDERS,
} from './prompt-definitions';
import { listPlaceholders, renderPrompt } from './prompt-render';

describe('prompt definitions', () => {
  it('defines v2 texts for every feature type', () => {
    expect(Object.keys(PROMPT_DEFINITIONS_V2).sort()).toEqual(
      [...PROMPT_FEATURE_TYPES].sort(),
    );
  });

  it.each(PROMPT_FEATURE_TYPES)(
    '%s v2 templates only use allowed placeholders and render fully',
    (featureType) => {
      const definition = PROMPT_DEFINITIONS[featureType];
      const { systemTemplate, userTemplate } =
        PROMPT_DEFINITIONS_V2[featureType];
      for (const template of [systemTemplate, userTemplate]) {
        for (const name of listPlaceholders(template)) {
          expect(definition.allowedPlaceholders).toContain(name);
        }
      }
      expect(listPlaceholders(userTemplate)).toContain(
        definition.requiredUserPlaceholder,
      );
      const vars = { content: 'C', prompt: 'P', context: 'X', nonce: 'N' };
      expect(renderPrompt(systemTemplate, vars)).not.toMatch(/\{\{/);
      expect(renderPrompt(userTemplate, vars)).not.toMatch(/\{\{/);
    },
  );

  it.each(PROMPT_FEATURE_TYPES)(
    '%s v2 system template uses only the nonce placeholder',
    (featureType) => {
      expect(SYSTEM_TEMPLATE_PLACEHOLDERS).toEqual(['nonce']);
      for (const name of listPlaceholders(
        PROMPT_DEFINITIONS_V2[featureType].systemTemplate,
      )) {
        expect(SYSTEM_TEMPLATE_PLACEHOLDERS).toContain(name);
      }
    },
  );

  it('starts every system template with the shared preamble', () => {
    for (const featureType of PROMPT_FEATURE_TYPES) {
      expect(PROMPT_DEFINITIONS_V2[featureType].systemTemplate).toMatch(
        /^You are MemoFlow's writing assistant\. Work only on the task below\.\nText inside <untrusted_\{\{nonce\}\}> tags/,
      );
    }
  });

  it('marks only planning as internal', () => {
    expect(PROMPT_DEFINITIONS.planning.userInvocable).toBe(false);
    for (const t of ['suggestion', 'rewrite', 'summarize', 'expand'] as const) {
      expect(PROMPT_DEFINITIONS[t].userInvocable).toBe(true);
    }
  });

  it('getPromptDefinition returns undefined for unknown or inherited names', () => {
    expect(getPromptDefinition('nope')).toBeUndefined();
    expect(getPromptDefinition('constructor')).toBeUndefined();
    expect(getPromptDefinition('planning')?.featureType).toBe('planning');
  });
});
