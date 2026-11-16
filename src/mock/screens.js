/* ============================================================
   模拟截图生成器:用内联 SVG 绘制"看起来像真实截图"的示例图幅。
   这些是 Demo 演示素材(合成数据),接入真实 AI API 后由用户上传
   的真实截图替换。
   ============================================================ */

function svgUri(body, width, height, extra = '') {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${extra}</defs>` +
    body +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---- 聊天截图(仿即时通讯) ---- */

function chatShot({ title, width = 400, height = 660, messages, person = '王工' }) {
  const leftColor = '#ffffff';
  const rightColor = '#95ec69';
  const textColor = '#1a1a1a';
  const tsColor = '#9aa0a6';

  let y = 64;
  const blocks = [];
  const nameOf = (m) => (m.me ? person : m.from || '对方');

  for (const m of messages) {
    const lines = m.text.split('\n');
    const lineH = 21;
    const padX = 12;
    const padY = 9;
    const maxW = 250;
    const w = Math.min(maxW, Math.max(...lines.map((l) => l.length)) * 14 + padX * 2);
    const h = lines.length * lineH + padY * 2;
    const showName = !m.me;
    if (showName) {
      blocks.push(
        `<text x="${m.me ? width - 16 - w : 16}" y="${y + 12}" font-size="11" fill="${tsColor}" font-family="sans-serif">${esc(nameOf(m))}</text>`
      );
      y += 16;
    }
    const x = m.me ? width - 16 - w : 16;
    blocks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${m.me ? rightColor : leftColor}"/>`);
    lines.forEach((l, i) => {
      blocks.push(
        `<text x="${x + padX}" y="${y + padY + lineH * i + 14}" font-size="14" fill="${textColor}" font-family="sans-serif">${esc(l)}</text>`
      );
    });
    y += h + 8;
    blocks.push(
      `<text x="${x}" y="${y + 2}" font-size="10" fill="${tsColor}" font-family="sans-serif">${m.ts}</text>`
    );
    y += 20;
  }

  const body =
    `<rect width="${width}" height="${height}" fill="#ededed"/>` +
    `<rect x="0" y="0" width="${width}" height="48" fill="#f7f7f7"/>` +
    `<text x="${width / 2}" y="29" font-size="15" font-weight="600" text-anchor="middle" fill="#1a1a1a" font-family="sans-serif">${esc(title)}</text>` +
    `<rect x="0" y="48" width="${width}" height="1" fill="#e0e0e0"/>` +
    blocks.join('') +
    `<rect x="0" y="${height - 44}" width="${width}" height="44" fill="#f7f7f7"/>` +
    `<rect x="${width / 2 - 70}" y="${height - 32}" width="140" height="26" rx="4" fill="#ffffff" stroke="#e0e0e0"/>`;

  return svgUri(body, width, height);
}

/* ---- 文档截图(仿任务清单/纪要) ---- */

function docShot({ title, width = 560, height = 700, lines, footer }) {
  const blocks = [];
  let y = 76;
  blocks.push(
    `<rect width="${width}" height="${height}" fill="#fbfaf7"/>`,
    `<rect x="0" y="0" width="${width}" height="56" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="34" font-size="17" font-weight="700" text-anchor="middle" fill="#222" font-family="sans-serif">${esc(title)}</text>`,
    `<rect x="0" y="56" width="${width}" height="1" fill="#e8e4dc"/>`
  );
  for (const ln of lines) {
    if (ln.kind === 'h') {
      y += 20;
      blocks.push(
        `<text x="48" y="${y}" font-size="14" font-weight="700" fill="#333" font-family="sans-serif">${esc(ln.text)}</text>`
      );
      y += 16;
    } else if (ln.kind === 'li') {
      y += 14;
      blocks.push(
        `<circle cx="58" cy="${y - 4}" r="2.4" fill="#8a8a8a"/>`,
        `<text x="72" y="${y}" font-size="13.5" fill="#444" font-family="sans-serif">${esc(ln.text)}</text>`
      );
      y += 24;
    } else {
      y += 14;
      blocks.push(
        `<text x="48" y="${y}" font-size="13.5" fill="#444" font-family="sans-serif">${esc(ln.text)}</text>`
      );
      y += 24;
    }
  }
  if (footer) {
    blocks.push(
      `<rect x="0" y="${height - 48}" width="${width}" height="48" fill="#f3f0e9"/>`,
      `<text x="48" y="${height - 20}" font-size="11" fill="#999" font-family="sans-serif">${esc(footer)}</text>`
    );
  }
  return svgUri(blocks.join(''), width, height);
}

/* ---- 表格截图(可选模糊,模拟低质量图幅) ---- */

function tableShot({ title, width = 580, height = 560, cols, rows, blur = 0, caption }) {
  const colW = (width - 96) / cols.length;
  const rowH = 40;
  const headH = 44;
  const startY = 96;
  const blocks = [];
  const f = blur > 0 ? `filter="url(#fblur)"` : '';

  blocks.push(`<rect width="${width}" height="${height}" fill="#fbfaf7"/>`);

  let tbl = '';
  tbl += `<rect x="48" y="${startY - headH}" width="${width - 96}" height="${headH}" fill="#eef1ea"/>`;
  cols.forEach((c, i) => {
    tbl += `<text x="${48 + colW * i + 12}" y="${startY - headH + 28}" font-size="13" font-weight="700" fill="#333" font-family="sans-serif">${esc(c)}</text>`;
  });
  rows.forEach((row, ri) => {
    const y0 = startY + ri * rowH;
    tbl += `<rect x="48" y="${y0}" width="${width - 96}" height="${rowH}" fill="${ri % 2 ? '#f6f3ec' : '#ffffff'}"/>`;
    row.forEach((cell, ci) => {
      const txt = cell == null || cell === '' ? '—' : cell;
      tbl += `<text x="${48 + colW * ci + 12}" y="${y0 + 26}" font-size="12.5" fill="#444" font-family="sans-serif">${esc(String(txt))}</text>`;
    });
  });
  // 表格边框
  tbl += `<rect x="48" y="${startY - headH}" width="${width - 96}" height="${headH + rows.length * rowH}" fill="none" stroke="#d8d2c4"/>`;
  for (let i = 1; i < cols.length; i++) {
    tbl += `<line x1="${48 + colW * i}" y1="${startY - headH}" x2="${48 + colW * i}" y2="${startY + rows.length * rowH}" stroke="#e4ded2"/>`;
  }
  for (let i = 1; i <= rows.length; i++) {
    tbl += `<line x1="48" y1="${startY + i * rowH}" x2="${width - 48}" y2="${startY + i * rowH}" stroke="#e4ded2"/>`;
  }

  blocks.push(
    `<rect width="${width}" height="${height}" fill="#fbfaf7"/>`,
    `<rect x="0" y="0" width="${width}" height="56" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="34" font-size="16" font-weight="700" text-anchor="middle" fill="#222" font-family="sans-serif">${esc(title)}</text>`,
    `<rect x="0" y="56" width="${width}" height="1" fill="#e8e4dc"/>`,
    caption ? `<text x="48" y="${startY - headH - 12}" font-size="11.5" fill="#888" font-family="sans-serif">${esc(caption)}</text>` : '',
    `<g ${f}>${tbl}</g>`
  );
  if (blur > 0) {
    blocks.unshift(
      `<filter id="fblur"><feGaussianBlur stdDeviation="${blur}"/></filter>`
    );
  }
  return svgUri(blocks.join(''), width, height);
}

/* ============================================================
   示例图幅:场景「供应商选型评审会」(4 张,含冲突/低质量/重复)
   ============================================================ */

export const PROC_SHOTS = [
  {
    id: 'img-proc-1',
    name: '选型会-群聊记录.png',
    width: 400,
    height: 660,
    sizeKb: 186,
    url: chatShot({
      title: '选型项目群 (12)',
      person: '我',
      messages: [
        { me: false, from: '王磊', ts: '09:41', text: '各位,供应商 A 的报价下来了\n年费 ¥268,000,交付周期 4 周' },
        { me: true, ts: '09:43', text: '收到,和供应商 B 一起对比下' },
        { me: false, from: '李敏', ts: '09:45', text: 'B 家之前说年费 ¥310,000\n但交付只要 2 周,需要权衡' },
        { me: false, from: '王磊', ts: '09:52', text: '我建议让技术这边明天先做\n一轮产品演示,再定' },
        { me: true, ts: '09:54', text: '同意。@李敏 你来约技术演示\n时间,同步大家' },
        { me: false, from: '李敏', ts: '10:02', text: '好,我约明天下午。另外财务\n说预算上限 30 万/年,注意' },
        { me: false, from: '王磊', ts: '10:05', text: 'A 家数据本地化也满足要求\n这点可以加分' },
      ],
    }),
    quality: { score: 94, label: '清晰', issues: [] },
    regions: [
      { id: 'r-price-a', label: '供应商 A 报价', x: 0.04, y: 0.14, w: 0.66, h: 0.1, note: '「年费 ¥268,000,交付周期 4 周」' },
      { id: 'r-budget', label: '预算上限', x: 0.04, y: 0.5, w: 0.66, h: 0.08, note: '「预算上限 30 万/年」' },
    ],
  },
  {
    id: 'img-proc-2',
    name: '报价单汇总.png',
    width: 580,
    height: 560,
    sizeKb: 312,
    url: tableShot({
      title: '供应商报价单汇总.xlsx',
      caption: '信息部 · 2024-11-10 更新',
      cols: ['供应商', '年费报价', '交付周期', '数据本地化'],
      rows: [
        ['供应商 A', '¥268,000', '4 周', '支持'],
        ['供应商 B', '¥310,000', '2 周', '支持'],
        ['供应商 C', '¥245,000', '6 周', '待确认'],
      ],
    }),
    quality: { score: 96, label: '清晰', issues: [] },
    regions: [
      { id: 'r-table-b', label: '供应商 B 行', x: 0.08, y: 0.33, w: 0.84, h: 0.07, note: '「¥310,000 / 2 周 / 支持」' },
    ],
  },
  {
    id: 'img-proc-3',
    name: '服务对比表(扫描件).png',
    width: 580,
    height: 560,
    sizeKb: 428,
    url: tableShot({
      title: '服务对比表-扫描.pdf',
      caption: '采购部归档 · 扫描件',
      cols: ['项目', 'A', 'B', 'C'],
      rows: [
        ['SLA 可用性', '99.9%', '99.95%', '99.5%'],
        ['实施支持', '标准', '专属', '—'],
        ['续费涨幅', '5%', '8%', '3%'],
        ['培训次数', '2 次', '4 次', '1 次'],
      ],
      blur: 1.3,
    }),
    quality: { score: 58, label: '模糊', issues: ['文字分辨率低', '部分单元格无法辨认'] },
    regions: [
      { id: 'r-sla', label: 'SLA 可用性行', x: 0.08, y: 0.2, w: 0.84, h: 0.07, note: '识别置信度低' },
    ],
  },
  {
    id: 'img-proc-4',
    name: '截止时间变更-群聊.png',
    width: 400,
    height: 660,
    sizeKb: 168,
    url: chatShot({
      title: '选型项目群 (12)',
      person: '我',
      messages: [
        { me: false, from: '王磊', ts: '14:20', text: '提醒:供应商 B 的 SLA 承诺函\n需要 11 月 25 日前拿到,刚和\n他们销售确认可以' },
        { me: true, ts: '14:22', text: '之前不是定的 11 月 20 日吗?' },
        { me: false, from: '王磊', ts: '14:23', text: '对,B 家说内部流程走不完\n顺延到 25 日,他们书面确认' },
        { me: false, from: '李敏', ts: '14:26', text: 'A 家交付周期 4 周,时间上\n赶得上评审,B 家 2 周' },
        { me: true, ts: '14:30', text: 'OK。大家更新一下各自的\n清单,别按旧日期记' },
      ],
    }),
    quality: { score: 92, label: '清晰', issues: [] },
    regions: [
      { id: 'r-deadline', label: '截止时间变更', x: 0.04, y: 0.13, w: 0.7, h: 0.11, note: '「11 月 25 日前」' },
      { id: 'r-dup-a', label: '交付周期(与图1重复)', x: 0.04, y: 0.48, w: 0.66, h: 0.08, note: '「A 家交付周期 4 周…B 家 2 周」' },
    ],
  },
];

/* ============================================================
   示例图幅:场景「Q4 产品上线动员会」(3 张,干净成功场景)
   ============================================================ */

export const MEET_SHOTS = [
  {
    id: 'img-meet-1',
    name: '动员会-群聊通知.png',
    width: 400,
    height: 640,
    sizeKb: 154,
    url: chatShot({
      title: '产品部大群 (86)',
      person: '我',
      messages: [
        { me: false, from: '张伟', ts: '10:00', text: '通知:Q4 产品上线动员会定于\n11 月 18 日(周一)14:00\n地点:3 号楼 2 层会议室 A' },
        { me: false, from: '张伟', ts: '10:01', text: '议程:版本 3.0 上线准备、\n测试进度、发布窗口确认' },
        { me: true, ts: '10:03', text: '收到,准时参加' },
        { me: false, from: '李娜', ts: '10:05', text: '研发这边同步一下:版本冻结\n定在 11 月 25 日,之后不再\n合入新需求' },
        { me: false, from: '张伟', ts: '10:07', text: '上线窗口暂定 12 月 2 日,\n运营提前一周准备公告' },
      ],
    }),
    quality: { score: 95, label: '清晰', issues: [] },
    regions: [
      { id: 'r-meet-time', label: '会议时间地点', x: 0.04, y: 0.13, w: 0.72, h: 0.12, note: '「11 月 18 日 14:00 · 3 号楼 2 层会议室 A」' },
    ],
  },
  {
    id: 'img-meet-2',
    name: '任务分工-群聊.png',
    width: 400,
    height: 620,
    sizeKb: 148,
    url: chatShot({
      title: '上线项目组 (9)',
      person: '我',
      messages: [
        { me: false, from: '张伟', ts: '16:20', text: '分工确认:\n测试用例评审:王强,11 月 21 日前\n上线公告:陈晨,11 月 26 日前' },
        { me: false, from: '张伟', ts: '16:21', text: '发布环境部署与回滚演练:\n李娜,11 月 28 日前完成' },
        { me: true, ts: '16:23', text: '收到,发布当天 10:00 全员\n待命确认' },
        { me: false, from: '王强', ts: '16:25', text: '评审材料我 20 号下午发出来' },
      ],
    }),
    quality: { score: 93, label: '清晰', issues: [] },
    regions: [
      { id: 'r-assign', label: '任务分工', x: 0.04, y: 0.13, w: 0.72, h: 0.16, note: '「测试用例评审:王强,11 月 21 日前」等' },
    ],
  },
  {
    id: 'img-meet-3',
    name: '上线计划表.png',
    width: 580,
    height: 540,
    sizeKb: 260,
    url: tableShot({
      title: 'Q4 上线计划表.xlsx',
      caption: '里程碑与负责人',
      cols: ['里程碑', '日期', '负责人'],
      rows: [
        ['版本冻结', '11-25', '李娜'],
        ['测试完成', '11-29', '王强'],
        ['公告发布', '11-26', '陈晨'],
        ['正式发布', '12-02', '全体'],
      ],
    }),
    quality: { score: 90, label: '清晰', issues: ['表格右侧列未完整截入'] },
    regions: [
      { id: 'r-plan', label: '里程碑表', x: 0.08, y: 0.22, w: 0.84, h: 0.55, note: '里程碑与负责人' },
    ],
  },
];
