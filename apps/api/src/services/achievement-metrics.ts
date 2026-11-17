/**
 * 成就指标注册表。对齐旧后端 `achievement/metrics.py` 的 METRIC_REGISTRY ——
 * 那边是装饰器注册，这里是一张表，作用一样：**后台下拉框里有什么，取决于代码里注册了什么**。
 *
 * 加一个新维度必须同时改这里和 `achievements.ts` 的计算逻辑并部署。
 * 只加这里而不算，会造出一个谁也拿不到的成就；只算而不加这里，后台就选不到它。
 */
export interface AchievementMetric {
  key: string
  name: string
  helpText: string
  /** 元指标：统计的是「已解锁成就数」自身，判定要在其它成就结算完之后再跑一轮 */
  meta?: boolean
}

export const ACHIEVEMENT_METRICS: AchievementMetric[] = [
  {
    key: 'accepted_count',
    name: '做对的题数',
    helpText: '去重后通过的题目数量（含比赛题）',
  },
  {
    key: 'mid_ac_count',
    name: '做对的中等题',
    helpText: '去重后通过的中等难度题目数（含比赛题）',
  },
  {
    key: 'hard_ac_count',
    name: '做对的困难题',
    helpText: '去重后通过的困难题目数（含比赛题）',
  },
  {
    key: 'submission_count',
    name: '提交次数',
    helpText: '提交次数（含比赛）',
  },
  { key: 'active_days', name: '有提交的天数', helpText: '有过提交的累计天数' },
  {
    key: 'max_ac_streak_days',
    name: '连续做对的天数',
    helpText: '连续每天至少 AC 一题的最长天数',
  },
  // 按周不按天：学生跟着课表来，2025 秋最长连续交题天数的中位数是 1 天、连续 7 天的
  // 只有 3 人，按天的「坚持一周」基本拿不到；按周的连续 2/4/8 周分别约 73%/49%/8%
  {
    key: 'max_ac_week_streak',
    name: '连续有新做对的周数',
    helpText: '连续几个自然周（周一起）每周都至少新通过一道题（含比赛题）',
  },
  { key: 'languages_used', name: '用过几种语言', helpText: '用过多少种编程语言' },
  {
    key: 'contest_joined',
    name: '参加比赛',
    helpText: '交过题的比赛数量',
  },
  { key: 'badge_count', name: '专题奖章', helpText: '获得的专题奖章数量' },
  {
    key: 'problemset_completed',
    name: '做完的专题',
    helpText: '完成的专题数量',
  },
  {
    key: 'challenge_count',
    name: '挑战成功',
    helpText: '做对之后的挑战，做到了几条（每道题的每条挑战算一次）',
  },
  {
    key: 'first_try_ac_count',
    name: '一次就对的题',
    helpText: '首次提交即通过的次数',
  },
  {
    key: 'midnight_submissions',
    name: '凌晨提交',
    helpText: '0:00–5:00 之间的提交次数',
  },
  {
    key: 'early_bird_submissions',
    name: '早起提交',
    helpText: '5:00–7:00 之间的提交次数',
  },
  {
    key: 'compile_error_count',
    name: '编译错误',
    helpText: '累计编译错误的次数',
  },
  {
    key: 'max_wa_before_ac',
    name: '错了几次才对',
    helpText: '单题失败最多多少次后终于通过',
  },
  {
    key: 'max_ac_in_one_day',
    name: '一天做对最多',
    helpText: '一天之内最多通过多少题',
  },
  {
    key: 'max_code_lines',
    name: '最长的代码行数',
    helpText: '做对的提交里最长的代码有多少行（空行不算，含比赛）',
  },
  {
    key: 'achievement_unlocked_count',
    name: '拿到的成就数',
    helpText: '已解锁的成就数量（不含白金档、已下架的和「小鲸鱼」那一组）',
    meta: true,
  },
  // 「小鲸鱼」那一组：从看板娘的互动记录数（services/mascot-achievements.ts），键必须以 mascot_ 开头 ——
  // 不算进奖杯收藏家、碰她时才结算，都是认这个前缀的
  { key: 'mascot_days', name: '小鲸鱼：来找她的天数', helpText: '有几天点过、拖过、喂过她（东八区日历日）' },
  { key: 'mascot_fed', name: '小鲸鱼：喂的小鱼干', helpText: '一共喂了她几条小鱼干' },
  { key: 'mascot_daily', name: '小鲸鱼：做对每天一道', helpText: '她每天挑的题，当天做对了几次' },
  { key: 'mascot_poses', name: '小鲸鱼：见过的样子', helpText: '见过她几种样子（一共 91 种）' },
  { key: 'mascot_lines', name: '小鲸鱼：听过的话', helpText: '她说过几句不一样的话' },
  { key: 'mascot_outfits', name: '小鲸鱼：换过的衣服', helpText: '给她换过几身不一样的衣服' },
  { key: 'mascot_answers', name: '小鲸鱼：答过的问题', helpText: '她闲聊时问的问题，答过几道不一样的' },
  { key: 'mascot_mistakes', name: '小鲸鱼：被指出的错', helpText: '写代码时被她指出过几种不一样的错' },
  { key: 'mascot_sulk', name: '小鲸鱼：惹她生闷气', helpText: '连点到她背过身去的次数' },
  { key: 'mascot_forgive_pat', name: '小鲸鱼：摸头哄好', helpText: '她生闷气时摸头哄好的次数' },
  { key: 'mascot_forgive_fish', name: '小鲸鱼：喂鱼哄好', helpText: '她生闷气时喂小鱼干哄好的次数' },
  { key: 'mascot_wake', name: '小鲸鱼：点醒', helpText: '把打盹的她点醒的次数' },
  { key: 'mascot_feed_wake', name: '小鲸鱼：喂醒', helpText: '她睡着时喂小鱼干喂醒的次数' },
  { key: 'mascot_peek_found', name: '小鲸鱼：捉迷藏', helpText: '她缩在屏幕边上时被找到的次数' },
  { key: 'mascot_fling', name: '小鲸鱼：甩晕', helpText: '把她甩出去撞晕的次数' },
  { key: 'mascot_shake', name: '小鲸鱼：摇晕', helpText: '拎着她摇晕的次数' },
  { key: 'mascot_tickle', name: '小鲸鱼：挠痒', helpText: '用鼠标给她挠痒的次数' },
  { key: 'mascot_tail', name: '小鲸鱼：揪尾巴', helpText: '揪过她尾巴就是 1' },
  { key: 'mascot_full', name: '小鲸鱼：喂撑', helpText: '喂到她说吃饱了的次数' },
  { key: 'mascot_overclick', name: '小鲸鱼：被嫌烦', helpText: '连点到她嫌烦的次数' },
  { key: 'mascot_festival', name: '小鲸鱼：过节换装', helpText: '节日当天给她穿上那天的节日装的次数' },
]

const BY_KEY = new Map(ACHIEVEMENT_METRICS.map((item) => [item.key, item]))

export function findMetric(key: string) {
  return BY_KEY.get(key) ?? null
}

export function metricName(key: string) {
  return BY_KEY.get(key)?.name ?? key
}
