const domains=[{id:'user',label:'申请人',color:'blue'},{id:'review',label:'审核',color:'orange'},{id:'system',label:'自动处理',color:'teal'},{id:'result',label:'结果',color:'green'}];
const n=(id,label,type='process',domain='system',extra={})=>({id,label,type,domain,...extra});
const e=(from,to,label,kind)=>({from,to,...(label?{label}:{}),...(kind?{kind}:{})});
module.exports={
  linear:{version:1,title:'内容发布 · 简单流程',description:'开始、处理与结束；宽度不足时本地重新纵向布局。',domains,
    nodes:[n('start','收到草稿','start','user'),n('validate','检查内容与附件'),n('publish','发布内容'),n('end','发布完成','end','result')],
    edges:[e('start','validate'),e('validate','publish','检查通过'),e('publish','end')],
    details:[{title:'处理规则',domain:'system',items:['此处是示例流程。细节放在图外，主图只保留活动与关系。']} ]},
  approval:{version:1,title:'费用审批 · 条件与退回',description:'条件写在箭头旁；退回后修订并重新进入审核。',domains,
    nodes:[n('start','提交费用单','start','user'),n('review','材料完整？','decision','review',{details:['检查发票、金额和申请理由。']}),n('edit','补充材料','process','user'),n('approve','负责人批准？','decision','review'),n('pay','安排付款'),n('done','付款完成','end','result'),n('reject','申请终止','end','result')],
    edges:[e('start','review'),e('review','edit','不完整'),e('edit','review','补齐后重审','loop'),e('review','approve','完整'),e('approve','pay','批准'),e('approve','reject','拒绝'),e('pay','done')],
    details:[{title:'申请人',domain:'user',items:['材料不足时只补充缺失内容，不重复创建申请。']},{title:'审核规则',domain:'review',items:['材料完整性与是否批准是两个独立判断。']} ]},
  retry:{version:1,title:'任务执行 · 重试与失败出口',description:'循环必须有退出条件，虚线表示返回重试。',domains,
    nodes:[n('start','接收任务','start'),n('run','执行任务'),n('ok','执行成功？','decision'),n('retry','还可以重试？','decision','review'),n('wait','等待退避间隔'),n('done','任务完成','end','result'),n('fail','记录失败并通知','end','result')],
    edges:[e('start','run'),e('run','ok'),e('ok','done','成功'),e('ok','retry','失败'),e('retry','wait','重试次数 < 3'),e('wait','run','等待后再次执行','loop'),e('retry','fail','已达上限')],
    notes:['示例策略：最多重试 3 次。流程图用于解释过程，不执行任务。']},
  parallel:{version:1,title:'发布准备 · 并行与汇合',description:'并行工作全部完成后再发布；分组表示同一团队的职责。',domains,
    groups:[{id:'team',label:'发布团队',domain:'system'}],
    nodes:[n('start','开始准备','start','user'),n('fork','并行准备','fork','system',{group:'team'}),n('security','安全检查与依赖项审核','process','review',{group:'team'}),n('tests','运行回归测试','process','system',{group:'team'}),n('docs','更新发布说明','process','user',{group:'team'}),n('join','全部完成','join','system',{group:'team'}),n('release','发布新版本','end','result')],
    edges:[e('start','fork'),e('fork','security'),e('fork','tests'),e('fork','docs'),e('security','join'),e('tests','join'),e('docs','join'),e('join','release')],
    details:[{title:'发布团队',domain:'system',items:['此示例中的三个任务可以并行完成。汇合节点表示全部完成，不表示条件二选一。']} ]}
};
