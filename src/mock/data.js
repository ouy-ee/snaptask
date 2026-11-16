/* ============================================================
   Mock 场景数据(合成演示数据)
   src 一律使用图例序号(1 起),由 mock service 映射为真实 imageId。
   字段约定:
   - value 为 null + status 'not-mentioned' → 界面显示「未提及」
   - status 'uncertain' → 界面标注「不确定」
   - conflict: { values: [{ value, src }] } → 对校展示
   ============================================================ */

/* ---------------- 场景 B:供应商选型(partial_success,4 图) ---------------- */

export const PROCUREMENT_RESULT = {
  scenario: 'partial',
  scene_type: 'COMPARISON',
  content_tags: ['资料', '待办'],
  summary: {
    oneLiner: {
      text: '选型评审会确定了供应商 A、B 的报价与交付周期,但 SLA 承诺函的截止时间存在两处不一致(11 月 20 日与 11 月 25 日),且 C 的服务数据因图幅模糊未能完整识别。',
      src: [1, 2, 4],
    },
    facts: [
      { id: 'sf-1', text: '供应商 A 年费报价 ¥268,000,交付周期 4 周,数据本地化满足要求。', src: [1, 2] },
      { id: 'sf-2', text: '供应商 B 年费报价 ¥310,000,交付周期 2 周,SLA 可用性 99.95%。', src: [2, 3] },
      { id: 'sf-3', text: '项目预算上限为 30 万/年。', src: [1] },
      { id: 'sf-4', text: '供应商 A 数据本地化满足要求,可以加分。', src: [1] },
    ],
    inferences: [
      { id: 'si-1', text: '供应商 A 在预算约束下更符合要求;若交付周期是硬约束,则 B 更优。', src: [1, 2] },
      { id: 'si-2', text: '供应商 C 年费最低(¥245,000),但数据本地化状态未确认,风险较高。', src: [2] },
    ],
    suggestions: [
      { id: 'ss-1', text: '优先与供应商 B 书面确认 SLA 承诺函的最终截止时间,消除冲突。', src: [2, 4] },
      { id: 'ss-2', text: '安排供应商 A、B 各做一轮技术演示后,再组织评审。', src: [1] },
      { id: 'ss-3', text: '向供应商 C 索取数据本地化与 SLA 的书面材料,补全对比表。', src: [2, 3] },
    ],
  },
  facts: [
    { id: 'f-1', label: '标题', value: '办公协作平台供应商选型评审', confidence: 0.96, status: 'identified', src: [1] },
    { id: 'f-2', label: '主题', value: '供应商 A / B / C 的报价、交付与服务水平对比', confidence: 0.58, status: 'uncertain', src: [1, 3] },
    { id: 'f-3', label: '关键实体', value: '供应商 A、供应商 B、供应商 C、信息部、采购部、财务部', confidence: 0.88, status: 'identified', src: [1, 2, 3] },
    { id: 'f-4', label: '时间', value: '2024-11-12 10:00(评审会)', confidence: 0.83, status: 'identified', src: [1] },
    { id: 'f-5', label: '角色', value: '王磊(信息部)、李敏(采购部)、财务部审批人(未具名)', confidence: 0.8, status: 'identified', src: [1, 4] },
    { id: 'f-6', label: '地点', value: null, confidence: null, status: 'not-mentioned', src: [] },
    { id: 'f-7', label: '约束条件', value: '预算上限 30 万/年;SLA 承诺函需在截止日前取得', confidence: 0.9, status: 'identified', src: [1, 2, 4] },
  ],
  keyFacts: [
    { id: 'kf-1', text: '供应商 A 年费 ¥268,000,交付 4 周,数据本地化支持。', confidence: 0.94, status: 'identified', src: [1, 2] },
    { id: 'kf-2', text: '供应商 B 年费 ¥310,000,交付 2 周,SLA 99.95%。', confidence: 0.92, status: 'identified', src: [2, 3] },
    { id: 'kf-3', text: '供应商 C 年费 ¥245,000,交付 6 周;SLA 99.5%。', confidence: 0.66, status: 'uncertain', src: [2, 3] },
    { id: 'kf-4', text: '预算上限 30 万/年。', confidence: 0.97, status: 'identified', src: [1] },
  ],
  tasks: [
    {
      id: 't-1',
      title: '向供应商 B 索取 SLA 承诺函',
      description: '获取书面 SLA 承诺函,用于评审材料;注意截止时间存在两处不一致。',
      assignee: '王磊',
      dueDate: { conflict: true, values: [{ value: '2024-11-20', src: [2] }, { value: '2024-11-25', src: [4] }] },
      priority: 'high',
      status: 'todo',
      done: false,
      src: [2, 4],
    },
    {
      id: 't-2',
      title: '组织供应商技术演示会',
      description: '约供应商 A、B 各做一轮产品演示,邀请技术与采购参加。',
      assignee: '李敏',
      dueDate: null,
      priority: 'medium',
      status: 'todo',
      done: false,
      src: [1],
    },
    {
      id: 't-3',
      title: '完成供应商对比报告并提交评审',
      description: '汇总报价、交付周期、SLA、数据本地化等维度,提交评审会。',
      assignee: null,
      dueDate: '2024-11-25',
      priority: 'medium',
      status: 'todo',
      done: false,
      src: [2, 4],
    },
    {
      id: 't-4',
      title: '复核供应商 A 的安全资质材料',
      description: '确认安全资质与数据本地化证明文件齐全。',
      assignee: '周涛',
      dueDate: '2024-11-22',
      priority: 'low',
      status: 'done',
      done: true,
      src: [1],
    },
  ],
  comparison: {
    id: 'cmp-1',
    title: '供应商方案对比',
    dims: [
      { id: 'd-price', label: '年费报价' },
      { id: 'd-delivery', label: '交付周期' },
      { id: 'd-sla', label: 'SLA 可用性' },
      { id: 'd-local', label: '数据本地化' },
      { id: 'd-support', label: '实施支持' },
    ],
    rows: [
      {
        id: 'row-a',
        label: '供应商 A',
        cells: {
          'd-price': { value: '¥268,000', src: [1, 2] },
          'd-delivery': { value: '4 周', src: [1] },
          'd-sla': { value: '99.9%', src: [3] },
          'd-local': { value: '支持', src: [1] },
          'd-support': { value: '标准', src: [3] },
        },
      },
      {
        id: 'row-b',
        label: '供应商 B',
        cells: {
          'd-price': { value: '¥310,000', src: [2] },
          'd-delivery': { value: '2 周', src: [2] },
          'd-sla': { value: '99.95%', src: [3] },
          'd-local': { value: '支持', src: [2] },
          'd-support': { value: '专属', src: [3] },
        },
      },
      {
        id: 'row-c',
        label: '供应商 C',
        cells: {
          'd-price': { value: '¥245,000', src: [2] },
          'd-delivery': { value: '6 周', src: [2] },
          'd-sla': { value: '99.5%', confidence: 0.55, src: [3] },
          'd-local': { value: null, missing: true, src: [2] },
          'd-support': { value: null, missing: true, src: [3] },
        },
      },
    ],
  },
  warnings: [
    {
      id: 'w-1',
      type: 'conflict',
      severity: 'high',
      title: '截止时间存在冲突',
      message: '「SLA 承诺函」的截止时间在图 2 中为 11 月 20 日,图 4 中为 11 月 25 日,请确认以哪个为准。',
      related: { kind: 'task', id: 't-1', label: '向供应商 B 索取 SLA 承诺函' },
      src: [2, 4],
      actions: ['定位并修正', '保留两处并标注'],
    },
    {
      id: 'w-2',
      type: 'missing-assignee',
      severity: 'medium',
      title: '任务缺少负责人',
      message: '「完成供应商对比报告并提交评审」未在任何图幅中识别到负责人。',
      related: { kind: 'task', id: 't-3', label: '完成供应商对比报告并提交评审' },
      src: [2, 4],
      actions: ['定位并填写', '标记为待定'],
    },
    {
      id: 'w-3',
      type: 'missing-due',
      severity: 'medium',
      title: '任务缺少截止时间',
      message: '「组织供应商技术演示会」未在图幅中识别到截止时间。',
      related: { kind: 'task', id: 't-2', label: '组织供应商技术演示会' },
      src: [1],
      actions: ['定位并填写', '标记为待定'],
    },
    {
      id: 'w-4',
      type: 'low-quality',
      severity: 'medium',
      title: '图 3 文字质量较低',
      message: '「服务对比表(扫描件)」分辨率低,部分单元格无法辨认,相关字段已标记为不确定或未提及。',
      related: { kind: 'image', id: '3', label: '服务对比表(扫描件).png' },
      src: [3],
      actions: ['查看该图幅', '重试识别'],
    },
    {
      id: 'w-5',
      type: 'low-confidence',
      severity: 'low',
      title: '「主题」字段置信度较低',
      message: '主题字段仅在图 1 与模糊的图 3 中部分出现,置信度 58%,已标注为不确定。',
      related: { kind: 'fact', id: 'f-2', label: '主题' },
      src: [1, 3],
      actions: ['定位并编辑', '确认无误'],
    },
    {
      id: 'w-6',
      type: 'duplicate',
      severity: 'low',
      title: '图 1 与图 4 内容存在重复',
      message: '「供应商 A 交付周期 4 周、B 家 2 周」在两处图幅中重复出现,已按相同事实合并,请确认。',
      related: { kind: 'fact', id: 'kf-1', label: '供应商 A 年费与交付周期' },
      src: [1, 4],
      actions: ['确认为重复', '查看两处原文'],
    },
  ],
};

/* ---------------- 场景 A:产品上线动员会(success,3 图) ---------------- */

export const MEETING_RESULT = {
  scenario: 'success',
  scene_type: 'TASK',
  content_tags: ['资料', '待办'],
  summary: {
    oneLiner: {
      text: 'Q4 产品上线动员会确定 3.0 版本将于 11 月 25 日冻结、12 月 2 日正式发布,测试评审、上线公告与发布演练三项工作已完成分工。',
      src: [1, 2, 3],
    },
    facts: [
      { id: 'sf-1', text: '版本 3.0 冻结日期为 11 月 25 日,之后不再合入新需求。', src: [1] },
      { id: 'sf-2', text: '正式上线窗口为 12 月 2 日,运营提前一周准备公告。', src: [1] },
      { id: 'sf-3', text: '测试用例评审由王强负责,11 月 21 日前完成;评审材料 11 月 20 日下午发出。', src: [2] },
    ],
    inferences: [
      { id: 'si-1', text: '上线公告(11 月 26 日)早于测试完成(11 月 29 日),公告内容以「计划上线」口径发布更稳妥。', src: [2, 3] },
    ],
    suggestions: [
      { id: 'ss-1', text: '发布当天 10:00 前完成全员待命确认与回滚演练复核。', src: [2, 3] },
      { id: 'ss-2', text: '建议补充正式发布后的值班与问题响应安排。', src: [] },
    ],
  },
  facts: [
    { id: 'f-1', label: '标题', value: 'Q4 产品上线动员会', confidence: 0.97, status: 'identified', src: [1] },
    { id: 'f-2', label: '主题', value: '版本 3.0 上线准备、测试进度与发布窗口确认', confidence: 0.92, status: 'identified', src: [1] },
    { id: 'f-3', label: '关键实体', value: '产品部、研发部、测试组、运营部;版本 3.0', confidence: 0.9, status: 'identified', src: [1, 2] },
    { id: 'f-4', label: '时间', value: '2024-11-18 14:00(会议);12 月 2 日(发布)', confidence: 0.95, status: 'identified', src: [1] },
    { id: 'f-5', label: '角色', value: '张伟(产品负责人)、李娜(研发负责人)、王强(测试负责人)、陈晨(运营)', confidence: 0.89, status: 'identified', src: [2, 3] },
    { id: 'f-6', label: '地点', value: '3 号楼 2 层会议室 A', confidence: 0.78, status: 'identified', src: [1] },
    { id: 'f-7', label: '约束条件', value: '11 月 25 日版本冻结;12 月 2 日上线窗口', confidence: 0.96, status: 'identified', src: [1, 3] },
  ],
  keyFacts: [
    { id: 'kf-1', text: '版本冻结:11 月 25 日(李娜)。', confidence: 0.97, status: 'identified', src: [1, 3] },
    { id: 'kf-2', text: '测试完成:11 月 29 日(王强)。', confidence: 0.93, status: 'identified', src: [3] },
    { id: 'kf-3', text: '上线公告:11 月 26 日(陈晨)。', confidence: 0.91, status: 'identified', src: [2, 3] },
    { id: 'kf-4', text: '正式发布:12 月 2 日 10:00,全员待命。', confidence: 0.9, status: 'identified', src: [2, 3] },
  ],
  tasks: [
    {
      id: 't-1',
      title: '完成 3.0 版本测试用例评审',
      description: '评审材料于 11 月 20 日下午发出,评审在 11 月 21 日前完成。',
      assignee: '王强',
      dueDate: '2024-11-21',
      priority: 'high',
      status: 'todo',
      done: false,
      src: [2],
    },
    {
      id: 't-2',
      title: '准备上线公告与培训材料',
      description: '运营提前一周准备公告,11 月 26 日前发布。',
      assignee: '陈晨',
      dueDate: '2024-11-26',
      priority: 'medium',
      status: 'todo',
      done: false,
      src: [2, 3],
    },
    {
      id: 't-3',
      title: '发布环境部署与回滚演练',
      description: '在正式发布前完成部署与回滚演练。',
      assignee: '李娜',
      dueDate: '2024-11-28',
      priority: 'high',
      status: 'doing',
      done: false,
      src: [2],
    },
    {
      id: 't-4',
      title: '12 月 2 日 10:00 正式发布',
      description: '发布当天全员待命确认。',
      assignee: '全体',
      dueDate: '2024-12-02',
      priority: 'high',
      status: 'todo',
      done: false,
      src: [2, 3],
    },
  ],
  comparison: {
    id: 'cmp-1',
    title: '上线方案对比',
    dims: [
      { id: 'd-mode', label: '发布方式' },
      { id: 'd-risk', label: '风险等级' },
      { id: 'd-rollback', label: '回滚时间' },
      { id: 'd-impact', label: '用户影响' },
      { id: 'd-effort', label: '所需人力' },
    ],
    rows: [
      {
        id: 'row-a',
        label: '方案 A · 灰度发布',
        cells: {
          'd-mode': { value: '按 5% → 50% → 100% 放量', src: [1] },
          'd-risk': { value: '低', src: [1] },
          'd-rollback': { value: '≤ 5 分钟', src: [1] },
          'd-impact': { value: '小范围可控', src: [1] },
          'd-effort': { value: '中等', src: [1] },
        },
      },
      {
        id: 'row-b',
        label: '方案 B · 全量发布',
        cells: {
          'd-mode': { value: '一次性全量', src: [1] },
          'd-risk': { value: '高', src: [1] },
          'd-rollback': { value: '≤ 15 分钟', src: [1] },
          'd-impact': { value: '全部用户', src: [1] },
          'd-effort': { value: '较低', src: [1] },
        },
      },
    ],
  },
  warnings: [
    {
      id: 'w-1',
      type: 'low-confidence',
      severity: 'low',
      title: '「地点」字段置信度较低',
      message: '「3 号楼 2 层会议室 A」中的楼层数字在图 1 中较小,置信度 78%,请核对。',
      related: { kind: 'fact', id: 'f-6', label: '地点' },
      src: [1],
      actions: ['定位并编辑', '确认无误'],
    },
  ],
};

/* ---------------- 场景 C:分析失败 ---------------- */

export const FAILED_RESULT = {
  scenario: 'failed',
  error: {
    code: 'MOCK_RECOGNIZE_TIMEOUT',
    title: '识别服务响应超时(模拟)',
    detail:
      '「识别注记」阶段未能按时完成。这是 Demo 内置的失败演示:接入真实 AI 服务后,此错误将对应 OCR / 多模态接口超时、网络中断或服务不可用,可安全重试。',
    recoverable: true,
  },
};
