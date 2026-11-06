import {
  getPromptDefinition,
  PROMPT_DEFINITIONS,
  PROMPT_DEFINITIONS_V2,
  PROMPT_DEFINITIONS_V3,
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

  describe('v3', () => {
    it('defines v3 texts for every feature type', () => {
      expect(Object.keys(PROMPT_DEFINITIONS_V3).sort()).toEqual(
        [...PROMPT_FEATURE_TYPES].sort(),
      );
    });

    it.each(PROMPT_FEATURE_TYPES)(
      '%s v3 templates only use allowed placeholders, render fully, and keep the system template to the nonce',
      (featureType) => {
        const definition = PROMPT_DEFINITIONS[featureType];
        const { systemTemplate, userTemplate } =
          PROMPT_DEFINITIONS_V3[featureType];
        for (const name of listPlaceholders(systemTemplate)) {
          expect(SYSTEM_TEMPLATE_PLACEHOLDERS).toContain(name);
        }
        for (const name of listPlaceholders(userTemplate)) {
          expect(definition.allowedPlaceholders).toContain(name);
        }
        expect(listPlaceholders(userTemplate)).toContain(
          definition.requiredUserPlaceholder,
        );
        const vars = { content: 'C', prompt: 'P', context: 'X', nonce: 'N' };
        expect(renderPrompt(systemTemplate, vars)).not.toMatch(/\{\{/);
        expect(renderPrompt(userTemplate, vars)).not.toMatch(/\{\{/);
      },
    );

    it('shares the v2 preamble and fences every placeholder in untrusted tags', () => {
      for (const featureType of PROMPT_FEATURE_TYPES) {
        const { systemTemplate, userTemplate } =
          PROMPT_DEFINITIONS_V3[featureType];
        expect(
          systemTemplate.startsWith(
            PROMPT_DEFINITIONS_V2[featureType].systemTemplate.split('\n\n')[0],
          ),
        ).toBe(true);
        for (const name of ['content', 'context', 'prompt']) {
          const tag = `<untrusted_{{nonce}}>\n{{${name}}}\n</untrusted_{{nonce}}>`;
          if (userTemplate.includes(`{{${name}}}`)) {
            expect(userTemplate).toContain(tag);
          }
        }
      }
    });

    it('adds the context rule to the invocable types and the context block to their user template', () => {
      for (const t of [
        'suggestion',
        'rewrite',
        'summarize',
        'expand',
      ] as const) {
        expect(PROMPT_DEFINITIONS_V3[t].systemTemplate).toMatch(
          /Use the context only to understand the text\. Do not rewrite or repeat it\.$/,
        );
        expect(PROMPT_DEFINITIONS_V3[t].userTemplate).toBe(
          'Context:\n<untrusted_{{nonce}}>\n{{context}}\n</untrusted_{{nonce}}>\n\nText:\n<untrusted_{{nonce}}>\n{{content}}\n</untrusted_{{nonce}}>',
        );
      }
      expect(PROMPT_DEFINITIONS_V3.planning.systemTemplate).not.toContain(
        'Use the context only',
      );
    });

    it('asks planning to cite numbered sources', () => {
      const { systemTemplate, userTemplate } = PROMPT_DEFINITIONS_V3.planning;
      expect(systemTemplate).toContain(
        'Draft an outline from the request and the numbered sources. Use only what the request and sources contain. Cite sources inline as [S1] and list the ids you used in sources. Never invent a source or a fact. If the sources are not enough, say so in the outline.',
      );
      expect(userTemplate).toBe(
        'Request:\n<untrusted_{{nonce}}>\n{{prompt}}\n</untrusted_{{nonce}}>\n\nSources:\n<untrusted_{{nonce}}>\n{{context}}\n</untrusted_{{nonce}}>',
      );
    });

    it('leaves the frozen v2 texts alone', () => {
      expect(PROMPT_DEFINITIONS_V2.planning.userTemplate).toContain(
        'Context:\n<untrusted_{{nonce}}>\n{{context}}',
      );
      expect(PROMPT_DEFINITIONS_V2.suggestion.userTemplate).toBe(
        '<untrusted_{{nonce}}>\n{{content}}\n</untrusted_{{nonce}}>',
      );
    });
  });
});
