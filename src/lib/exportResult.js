export function getContentTags(result) {
  if (result?.content_tags?.length) return result.content_tags;
  const tags = [];
  if ((result?.tasks?.length || 0) + (result?.summary?.suggestions?.length || 0) > 0) tags.push('待办');
  if ((result?.summary?.oneLiner?.text || '').length > 20 || result?.keyFacts?.length || result?.facts?.length) tags.push('资料');
  return tags;
}

function taskLine(task) {
  const due = task.dueDate?.conflict ? task.dueDate.values.map((v) => v.value).join(' / ') : task.dueDate || '未设置';
  return `- [${task.done ? 'x' : ' '}] ${task.title}${task.assignee ? `（负责人: ${task.assignee}` : '（负责人: 未设置'}，截止: ${due}）`;
}

export function buildExportText(result, selected, format = 'md') {
  const title = result.summary?.oneLiner?.text || 'SnapTask 截图分析结果';
  const lines = format === 'md' ? [`# ${title}`, ''] : [title, ''];
  const section = (heading, body) => { lines.push(format === 'md' ? `## ${heading}` : heading, body, ''); };
  if (selected.summary) section('核心总结', title);
  if (selected.tasks) section('任务清单', (result.tasks || []).map(taskLine).concat((result.summary?.suggestions || []).map((item) => `- [ ] ${item.text}（AI 建议）`)).join('\n') || '暂无任务');
  if (selected.facts) section('原始结构化信息', (result.facts || []).map((fact) => `- ${fact.label || '字段'}: ${fact.value || '未提及'}`).join('\n') || '暂无结构化信息');
  if (selected.comparison && result.comparison) section(result.comparison.title || '方案对比', result.comparison.rows.map((row) => `- ${row.label}: ${Object.values(row.cells).map((cell) => cell.value || '未提及').join(' / ')}`).join('\n'));
  return lines.join('\n').trim() + '\n';
}

export function downloadResult(result, selected, format) {
  const text = buildExportText(result, selected, format);
  const blob = new Blob([text], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `snaptask-${Date.now()}.${format === 'md' ? 'md' : 'txt'}`;
  link.click();
  URL.revokeObjectURL(url);
}
