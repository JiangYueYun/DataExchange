/* dsh-compaction-pack — browser half: the compaction tuning card on the Plugins page.
 *
 * Binds the `compaction-tuning` settings namespace (every field is volatile in
 * the Host plugin, so edits apply to the next compaction without a restart) and
 * renders it with the shared settings primitives.
 */
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-compaction-pack',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    var h = React.createElement;

    var NS = 'settings.compactionPack';
    var TUNING_NS = 'compaction-tuning';

    var en = {
      title: 'Compaction tuning',
      description: 'Thresholds, verbatim retention, summary route, and the checkpoint instruction used by the compaction engine.',
      enabled: 'Automatic compaction',
      enabledHint: 'Off stops pressure compaction and overflow recovery. Manual /compact still works.',
      policy: 'Policy',
      thresholdRatio: 'Threshold ratio',
      thresholdRatioHint: 'Compact when measured pressure reaches this fraction of the context window (0.05-1).',
      headroomTokens: 'Headroom tokens',
      headroomTokensHint: 'Extra pressure margin reserved on top of the request output budget.',
      retainRatio: 'Retain ratio',
      retainRatioHint: 'Verbatim recent tail as a fraction of the message budget (window minus output budget).',
      retainTokens: 'Retain tokens',
      retainTokensHint: 'Absolute verbatim tail budget. Set it to override the ratio; clear it to use the ratio.',
      maxSummaryTokens: 'Summary output cap',
      maxSummaryTokensHint: 'Maximum tokens one checkpoint may produce.',
      compactionRetries: 'Retries per trigger',
      compactionRetriesHint: 'Extra passes inside one trigger when pressure stays above the threshold.',
      maxOverflowRetries: 'Overflow retries',
      maxOverflowRetriesHint: 'Retries after a provider-confirmed context overflow.',
      overflowRetainTokens: 'Overflow retain tokens',
      overflowRetainTokensHint: 'Verbatim tail kept during overflow recovery. 0 compacts everything but the last node.',
      route: 'Summary route',
      summarizationProvider: 'Provider',
      summarizationProviderHint: 'Empty follows the model that produced the latest answer.',
      summarizationModel: 'Model',
      summarizationModelHint: 'Empty follows the model that produced the latest answer.',
      language: 'Checkpoint language',
      languageHint: 'Auto follows the language the user writes in.',
      languageAuto: 'Auto',
      languageZh: 'Chinese',
      languageEn: 'English',
      prompt: 'Checkpoint instruction',
      promptHint: 'Sent as the final user message of the summary request. Clear it to fall back to a minimal instruction for A/B comparison.',
      outputCap: 'Output reservation',
      outputCapHint: 'Caps max_tokens on every routed model. A smaller reservation raises the compaction threshold, so history survives longer.',
      outputCapEnabled: 'Clamp the request output reservation',
      outputCapEnabledHint: 'Off leaves every model at the value its route declares.',
      outputCapDefault: 'Default cap (tokens)',
      outputCapDefaultHint: 'Applied to models and sessions without an override. Observed outputs: p99 9.7k, max 52.7k.',
      outputCapByPreset: 'Per-preset overrides (JSON)',
      outputCapByPresetHint: 'Example: {"ptc": 393216}. Longest match wins over the default.',
      outputCapByWorkspace: 'Per-workspace overrides (JSON)',
      outputCapByWorkspaceHint: 'Example: {"D:\\\\work\\\\repo": 196608}. Longest matching cwd prefix wins.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'The compaction tuning plugin is not loaded, so nothing can be configured here.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    };
    var zh = {
      title: '压缩调参',
      description: '压缩引擎的阈值、逐字保留、摘要路由与检查点指令。',
      enabled: '自动压缩',
      enabledHint: '关闭后不再按压力压缩，也不再做溢出恢复；手动 /compact 仍可用。',
      policy: '策略',
      thresholdRatio: '触发阈值比例',
      thresholdRatioHint: '实测压力达到上下文窗口的这个比例时触发压缩（0.05-1）。',
      headroomTokens: '余量 tokens',
      headroomTokensHint: '在请求输出预算之外额外预留的压力余量。',
      retainRatio: '保留比例',
      retainRatioHint: '逐字保留的近期尾部占消息预算（窗口减输出预算）的比例。',
      retainTokens: '保留 tokens',
      retainTokensHint: '绝对的逐字保留预算；填了就覆盖比例，留空则用比例。',
      maxSummaryTokens: '摘要输出上限',
      maxSummaryTokensHint: '一条检查点最多可以输出的 token 数。',
      compactionRetries: '单次触发重试',
      compactionRetriesHint: '仍在阈值之上时，在一次触发内继续压缩的次数。',
      maxOverflowRetries: '溢出重试',
      maxOverflowRetriesHint: '提供方确认上下文溢出后的重试次数。',
      overflowRetainTokens: '溢出保留 tokens',
      overflowRetainTokensHint: '溢出恢复时逐字保留的尾部；0 表示除最后一个节点外全部压缩。',
      route: '摘要路由',
      summarizationProvider: '提供方',
      summarizationProviderHint: '留空则跟随最近一次作答的模型。',
      summarizationModel: '模型',
      summarizationModelHint: '留空则跟随最近一次作答的模型。',
      language: '检查点语言',
      languageHint: '自动跟随用户书写的语言。',
      languageAuto: '自动',
      languageZh: '中文',
      languageEn: '英文',
      prompt: '检查点指令',
      promptHint: '作为摘要请求的最后一条 user 消息发送。清空后回退到最小指令，便于做 A/B 对照。',
      outputCap: '输出预留',
      outputCapHint: '对每个路由的 max_tokens 收上限。预留越小，压缩阈值越高，历史能留得更久。',
      outputCapEnabled: '限制请求输出预留',
      outputCapEnabledHint: '关闭后每个模型仍用其路由声明的值。',
      outputCapDefault: '默认上限（tokens）',
      outputCapDefaultHint: '用于没有单独覆盖的模型与会话。实测输出：p99 9.7k，最大 52.7k。',
      outputCapByPreset: '按预设覆盖（JSON）',
      outputCapByPresetHint: '例：{"ptc": 393216}。匹配优先于默认值。',
      outputCapByWorkspace: '按工作目录覆盖（JSON）',
      outputCapByWorkspaceHint: '例：{"D:\\\\work\\\\repo": 196608}。cwd 前缀最长匹配优先。',
      readOnly: '本部署的设置为只读。',
      unavailable: '压缩调参插件未加载，此处暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    };

    /** A boolean field rendered as a checkbox. */
    function booleanField(field) {
      return {
        field: field,
        format: function (value) { return value === false ? 'false' : 'true'; },
        parse: function (text) { return { kind: 'set', value: text !== 'false' }; },
      };
    }

    /** A block field: an empty draft writes an empty string instead of clearing the key. */
    function blockField(field) {
      return {
        field: field,
        format: function (value) { return typeof value === 'string' ? value : ''; },
        parse: function (text) { return { kind: 'set', value: text }; },
      };
    }

    /** A fixed-choice field. */
    function choiceField(field, choices) {
      return {
        field: field,
        format: function (value) { return typeof value === 'string' ? value : choices[0]; },
        parse: function (text) {
          return choices.indexOf(text) === -1 ? undefined : { kind: 'set', value: text };
        },
      };
    }

    var FIELDS = [
      booleanField('enabled'),
      primitives.settingsNumberField('thresholdRatio'),
      primitives.settingsNumberField('headroomTokens'),
      primitives.settingsNumberField('retainRatio'),
      primitives.settingsNumberField('retainTokens'),
      primitives.settingsNumberField('maxSummaryTokens'),
      primitives.settingsNumberField('compactionRetries'),
      primitives.settingsNumberField('maxOverflowRetries'),
      primitives.settingsNumberField('overflowRetainTokens'),
      primitives.settingsTextField('summarizationProvider'),
      primitives.settingsTextField('summarizationModel'),
      choiceField('language', ['auto', 'zh', 'en']),
      blockField('prompt'),
      booleanField('outputCapEnabled'),
      primitives.settingsNumberField('outputCapDefault'),
      blockField('outputCapByPreset'),
      blockField('outputCapByWorkspace'),
    ];

    var style = {
      group: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' },
      row: { display: 'flex', flexDirection: 'column', gap: '4px' },
      label: { fontSize: '13px', fontWeight: 600 },
      input: { fontSize: '13px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-border, #d0d0d0)' },
      textarea: { fontSize: '12px', lineHeight: 1.5, padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-border, #d0d0d0)', fontFamily: 'ui-monospace, monospace' },
      hint: { fontSize: '11px', opacity: 0.6, margin: 0 },
      checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' },
      section: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', opacity: 0.55, margin: '4px 0 8px' },
    };

    function textField(t, state, props, field, labelKey, hintKey) {
      return h('div', { key: field, style: style.group },
        h('label', { style: style.label, htmlFor: 'compaction-pack-' + field }, t(labelKey)),
        h('input', {
          id: 'compaction-pack-' + field,
          style: style.input,
          type: 'text',
          value: state[field].text,
          disabled: !state.writable,
          'aria-invalid': state[field].invalid || undefined,
          onChange: function (event) { props.edit(field, event.target.value); },
        }),
        h('p', { style: style.hint }, t(hintKey)),
      );
    }

    function CompactionPackCard(props) {
      var t = props.t;
      var state = props.useCompactionPackCard(function (snapshot) { return snapshot; });
      if (props.view === 'summary') return t('description');
      var children = [
        h('p', { key: 'desc', style: style.hint }, t('description')),
        h('div', { key: 'enabled', style: style.group },
          h('label', { style: style.checkbox },
            h('input', {
              type: 'checkbox',
              checked: state.enabled.text === 'true',
              disabled: !state.writable,
              onChange: function (event) { props.edit('enabled', event.target.checked ? 'true' : 'false'); },
            }),
            t('enabled'),
          ),
          h('p', { style: style.hint }, t('enabledHint')),
        ),
        h('div', { key: 'policy', style: style.section }, t('policy')),
        textField(t, state, props, 'thresholdRatio', 'thresholdRatio', 'thresholdRatioHint'),
        textField(t, state, props, 'headroomTokens', 'headroomTokens', 'headroomTokensHint'),
        textField(t, state, props, 'retainRatio', 'retainRatio', 'retainRatioHint'),
        textField(t, state, props, 'retainTokens', 'retainTokens', 'retainTokensHint'),
        textField(t, state, props, 'maxSummaryTokens', 'maxSummaryTokens', 'maxSummaryTokensHint'),
        textField(t, state, props, 'compactionRetries', 'compactionRetries', 'compactionRetriesHint'),
        textField(t, state, props, 'maxOverflowRetries', 'maxOverflowRetries', 'maxOverflowRetriesHint'),
        textField(t, state, props, 'overflowRetainTokens', 'overflowRetainTokens', 'overflowRetainTokensHint'),
        h('div', { key: 'route', style: style.section }, t('route')),
        textField(t, state, props, 'summarizationProvider', 'summarizationProvider', 'summarizationProviderHint'),
        textField(t, state, props, 'summarizationModel', 'summarizationModel', 'summarizationModelHint'),
        h('div', { key: 'language', style: style.group },
          h('label', { style: style.label, htmlFor: 'compaction-pack-language' }, t('language')),
          h('select', {
            id: 'compaction-pack-language',
            style: style.input,
            value: state.language.text,
            disabled: !state.writable,
            onChange: function (event) { props.edit('language', event.target.value); },
          },
          h('option', { value: 'auto' }, t('languageAuto')),
          h('option', { value: 'zh' }, t('languageZh')),
          h('option', { value: 'en' }, t('languageEn')),
          ),
          h('p', { style: style.hint }, t('languageHint')),
        ),
        h('div', { key: 'prompt', style: style.group },
          h('label', { style: style.label, htmlFor: 'compaction-pack-prompt' }, t('prompt')),
          h('textarea', {
            id: 'compaction-pack-prompt',
            style: style.textarea,
            rows: 18,
            value: state.prompt.text,
            disabled: !state.writable,
            onChange: function (event) { props.edit('prompt', event.target.value); },
          }),
          h('p', { style: style.hint }, t('promptHint')),
        ),
        h('div', { key: 'outputCap', style: style.section }, t('outputCap')),
        h('p', { key: 'outputCapHint', style: style.hint }, t('outputCapHint')),
        h('div', { key: 'outputCapEnabled', style: style.group },
          h('label', { style: style.checkbox },
            h('input', {
              type: 'checkbox',
              checked: state.outputCapEnabled.text === 'true',
              disabled: !state.writable,
              onChange: function (event) {
                props.edit('outputCapEnabled', event.target.checked ? 'true' : 'false');
              },
            }),
            t('outputCapEnabled'),
          ),
          h('p', { style: style.hint }, t('outputCapEnabledHint')),
        ),
        textField(t, state, props, 'outputCapDefault', 'outputCapDefault', 'outputCapDefaultHint'),
        h('div', { key: 'outputCapByPreset', style: style.group },
          h('label', { style: style.label, htmlFor: 'compaction-pack-cap-preset' }, t('outputCapByPreset')),
          h('textarea', {
            id: 'compaction-pack-cap-preset',
            style: style.textarea,
            rows: 3,
            value: state.outputCapByPreset.text,
            disabled: !state.writable,
            onChange: function (event) { props.edit('outputCapByPreset', event.target.value); },
          }),
          h('p', { style: style.hint }, t('outputCapByPresetHint')),
        ),
        h('div', { key: 'outputCapByWorkspace', style: style.group },
          h('label', { style: style.label, htmlFor: 'compaction-pack-cap-workspace' }, t('outputCapByWorkspace')),
          h('textarea', {
            id: 'compaction-pack-cap-workspace',
            style: style.textarea,
            rows: 3,
            value: state.outputCapByWorkspace.text,
            disabled: !state.writable,
            onChange: function (event) { props.edit('outputCapByWorkspace', event.target.value); },
          }),
          h('p', { style: style.hint }, t('outputCapByWorkspaceHint')),
        ),
      ];
      return h(primitives.SettingsForm, {
        labels: {
          unavailable: t('unavailable'),
          readOnly: t('readOnly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        },
        state: state,
        onSave: props.save,
        onDiscard: props.discard,
      }, children);
    }

    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, 'compaction-pack: dictionaries');
      var t = ctx.locale.bind(NS);
      var form = new primitives.SettingsFormModel(ctx.configForms.get(TUNING_NS), FIELDS);
      var store = form.bind(function () {
        var projection = form.shell();
        for (var index = 0; index < FIELDS.length; index += 1) {
          var field = FIELDS[index].field;
          projection[field] = form.field(field);
        }
        return projection;
      });
      ctx.effect(function () { return function () { form.dispose(); }; }, 'compaction-pack: form subscription');
      ctx.effect(function () {
        return ctx.configForms.whileServed([TUNING_NS], function () {
          return ctx.slots.inject('plugins.item', function () {
            return ctx.slots.register({
              name: 'plugins.item',
              id: 'compaction-pack',
              order: 26,
              label: function () { return t('title'); },
              locale: NS,
              inject: function () {
                var face = form.actions();
                return {
                  edit: face.edit,
                  resetField: face.resetField,
                  save: face.save,
                  discard: face.discard,
                  hooks: { compactionPackCard: store },
                };
              },
            }, CompactionPackCard);
          });
        });
      }, 'compaction-pack: page');
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale', 'configForms'];
    return module.exports;
  },
});
