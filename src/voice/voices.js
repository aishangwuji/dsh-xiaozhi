/**
 * 音色目录 —— 与 Go 服务端 manager/backend/controllers/voice_constants.go 同源。
 *
 * 只搬运本插件真正支持的厂商：edge、xunfei(讯飞)、volc(豆包/火山)。
 * 生成方式：解析 voice_constants.go 的 {Value, Label} 列表，逐条原样保留，
 * 不做改名、不做裁剪，这样控制台里选出来的值就是服务端认识的发音人 ID。
 *
 * `languages` 不是 Go 那边带的，来自 Java 分支 `ai_tts_voice.languages`
 * （manager-api 的 db/changelog 种子）：语种是音色自己的属性。没有对应官方行的
 * 音色直接省略该字段 —— 宁可不显示，也不猜。末尾 4 条 `multi_*` 是官方音色表里
 * 唯一能说日语的豆包 1.0 音色（中文表里它们另有中文名），资源族需要 seed-tts-1.0。
 */

export const VOICE_OPTIONS = {
  "edge": [
    {
      "value": "zh-CN-XiaoxiaoNeural",
      "label": "晓晓（女声）"
    },
    {
      "value": "zh-CN-YunxiNeural",
      "label": "云希（男声）"
    },
    {
      "value": "zh-CN-YunyangNeural",
      "label": "云扬（男声）"
    },
    {
      "value": "zh-CN-XiaoyiNeural",
      "label": "晓伊（女声）"
    },
    {
      "value": "zh-CN-YunjianNeural",
      "label": "云健（男声）"
    },
    {
      "value": "zh-CN-YunxiaNeural",
      "label": "云夏（男声）"
    },
    {
      "value": "zh-CN-YunhaoNeural",
      "label": "云皓（男声）"
    },
    {
      "value": "zh-CN-XiaohanNeural",
      "label": "晓涵（女声）"
    },
    {
      "value": "zh-CN-XiaomoNeural",
      "label": "晓墨（女声）"
    },
    {
      "value": "zh-CN-XiaoxuanNeural",
      "label": "晓萱（女声）"
    },
    {
      "value": "zh-CN-XiaoruiNeural",
      "label": "晓睿（女声）"
    },
    {
      "value": "zh-CN-XiaoshuangNeural",
      "label": "晓双（女声）"
    },
    {
      "value": "zh-CN-XiaoyanNeural",
      "label": "晓颜（女声）"
    },
    {
      "value": "zh-CN-XiaoyouNeural",
      "label": "晓悠（女声）"
    },
    {
      "value": "zh-CN-XiaozhenNeural",
      "label": "晓甄（女声）"
    },
    {
      "value": "zh-CN-YunfengNeural",
      "label": "云枫（男声）"
    },
    {
      "value": "zh-CN-YunyeNeural",
      "label": "云野（男声）"
    },
    {
      "value": "zh-CN-YunzeNeural",
      "label": "云泽（男声）"
    }
  ],
  "xunfei": [
    {
      "value": "xiaoyan",
      "label": "小燕（女声，默认推荐）"
    },
    {
      "value": "xiaofeng",
      "label": "晓峰（男声）"
    },
    {
      "value": "yezi",
      "label": "小露（女声）"
    },
    {
      "value": "yifei",
      "label": "一菲（女声）"
    },
    {
      "value": "yiping",
      "label": "一萍（女声）"
    },
    {
      "value": "qige",
      "label": "七哥（男声）"
    },
    {
      "value": "chaoge",
      "label": "超哥（男声）"
    },
    {
      "value": "pengfei",
      "label": "小鹏（男声）"
    },
    {
      "value": "xiaoxin",
      "label": "萌小新（童声）"
    },
    {
      "value": "john",
      "label": "John（英文男声）"
    },
    {
      "value": "catherine",
      "label": "Catherine（英文女声）"
    }
  ],
  "volc": [
    {
      "value": "zh_female_cancan_mars_bigtts",
      "label": "灿灿 / Shiny（女声）",
      "languages": "中文、美式英语",
      "tier": "1.x"
    },
    {
      "value": "zh_female_vv_uranus_bigtts",
      "label": "vivi 2.0（女声）",
      "languages": "普通话、日语、印尼语、墨西哥西班牙语",
      "tier": "2.0"
    },
    {
      "value": "zh_female_vv_jupiter_bigtts",
      "label": "vivi O版（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_xiaohe_jupiter_bigtts",
      "label": "小何 O版（女声）",
      "tier": "1.x"
    },
    {
      "value": "saturn_zh_female_cancan_tob",
      "label": "知性灿灿（女声）",
      "tier": "2.0"
    },
    {
      "value": "saturn_zh_female_keainvsheng_tob",
      "label": "可爱女生（女声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "saturn_zh_female_tiaopigongzhu_tob",
      "label": "调皮公主（女声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "zh_female_xiaohe_uranus_bigtts",
      "label": "小何（女声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tianmeitaozi_mars_bigtts",
      "label": "甜美桃子（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_wanwanxiaohe_moon_bigtts",
      "label": "湾湾小何（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_qinqienvsheng_moon_bigtts",
      "label": "亲切女声（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_vv_mars_bigtts",
      "label": "Vivi（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_tianmeixiaoyuan_moon_bigtts",
      "label": "甜美小源（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_qingchezizi_moon_bigtts",
      "label": "清澈梓梓（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_kailangjiejie_moon_bigtts",
      "label": "开朗姐姐（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_tianmeiyueyue_moon_bigtts",
      "label": "甜美悦悦（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_xinlingjitang_moon_bigtts",
      "label": "心灵鸡汤（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_zhixingnvsheng_mars_bigtts",
      "label": "知性女声（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_wenroushunv_mars_bigtts",
      "label": "温柔淑女（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_wenrouxiaoya_moon_bigtts",
      "label": "温柔小雅（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_linjianvhai_moon_bigtts",
      "label": "邻家女孩（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_shuangkuaisisi_moon_bigtts",
      "label": "爽快思思/Skye（女声）",
      "languages": "中文、英文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_gaolengyujie_moon_bigtts",
      "label": "高冷御姐（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_meilinvyou_moon_bigtts",
      "label": "魅力女友（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_sajiaonvyou_moon_bigtts",
      "label": "柔美女友（撒娇）（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_female_yuanqinvyou_moon_bigtts",
      "label": "撒娇学妹（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_wenrounvshen_239eff5e8ffa_tob",
      "label": "温柔女神（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_chunzhenshaonv_e588402fb8ad_tob",
      "label": "纯真少女（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_jinglingxiangdao_1beb294a9e3e_tob",
      "label": "精灵向导（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_yilin_tob",
      "label": "贴心妹妹（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_chengshujiejie_tob",
      "label": "成熟姐姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_bingjiaojiejie_tob",
      "label": "病娇姐姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_wumeiyujie_tob",
      "label": "妩媚御姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_aojiaonvyou_tob",
      "label": "傲娇女友（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_tiexinnvyou_tob",
      "label": "贴心女友（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_xingganyujie_tob",
      "label": "性感御姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_lixingyuanzi_cs_tob",
      "label": "理性圆子（客服女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_wuxi_tob",
      "label": "元气甜妹（女声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_female_zhixingwenwan_tob",
      "label": "知性温婉（女声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "saturn_zh_male_shuanglangshaonian_tob",
      "label": "爽朗少年（男声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "saturn_zh_male_tiancaitongzhuo_tob",
      "label": "天才同桌（男声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "zh_male_yunzhou_jupiter_bigtts",
      "label": "云舟 O版（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_xiaotian_jupiter_bigtts",
      "label": "小天 O版（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_m191_uranus_bigtts",
      "label": "云舟（男声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "zh_male_taocheng_uranus_bigtts",
      "label": "小天（男声）",
      "languages": "普通话、英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_tim_uranus_bigtts",
      "label": "Tim（英文男声）",
      "languages": "英语",
      "tier": "2.0"
    },
    {
      "value": "zh_male_yangguangqingnian_moon_bigtts",
      "label": "阳光青年（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_qingshuangnanda_mars_bigtts",
      "label": "清爽男大（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_wenrouxiaoge_mars_bigtts",
      "label": "温柔小哥（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_qingcang_mars_bigtts",
      "label": "擎苍（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_ruyaqingnian_mars_bigtts",
      "label": "儒雅青年（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_jieshuoxiaoming_moon_bigtts",
      "label": "解说小明（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_linjiananhai_moon_bigtts",
      "label": "邻家男孩（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_yuanboxiaoshu_moon_bigtts",
      "label": "渊博小叔（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_wennuanahu_moon_bigtts",
      "label": "温暖阿虎/Alvin（男声）",
      "languages": "中文、英文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_shaonianzixin_moon_bigtts",
      "label": "少年梓辛/Brayan（男声）",
      "languages": "中文、英文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_beijingxiaoye_moon_bigtts",
      "label": "北京小爷（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_jingqiangkanye_moon_bigtts",
      "label": "京腔侃爷/Harmony（男声）",
      "languages": "中文、英文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_guozhoudege_moon_bigtts",
      "label": "广州德哥（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_haoyuxiaoge_moon_bigtts",
      "label": "浩宇小哥（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_shenyeboke_moon_bigtts",
      "label": "深夜播客（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_aojiaobazong_moon_bigtts",
      "label": "傲娇霸总（男声）",
      "languages": "中文",
      "tier": "1.x"
    },
    {
      "value": "zh_male_dongfanghaoran_moon_bigtts",
      "label": "东方浩然（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_M100_conversation_wvae_bigtts",
      "label": "悠悠君子/Lucas（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_xudong_conversation_wvae_bigtts",
      "label": "快乐小东/Daníel（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_qingyiyuxuan_mars_bigtts",
      "label": "阳光阿辰（男声）",
      "tier": "1.x"
    },
    {
      "value": "en_male_jason_conversation_wvae_bigtts",
      "label": "开朗学长（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_lengkugege_v1_tob",
      "label": "冷酷哥哥（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_shenmi_v1_tob",
      "label": "机灵小伙（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_BV705_streaming_cs_tob",
      "label": "炀炀（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_menyoupingxiaoge_ffed9fc2fee7_tob",
      "label": "闷油瓶小哥（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_anrenqinzhu_cd62e63dcdab_tob",
      "label": "黯刃秦主（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_guaogongzi_v1_tob",
      "label": "孤傲公子（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_bingruogongzi_tob",
      "label": "病弱公子（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_bingjiaodidi_tob",
      "label": "病娇弟弟（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_aomanshaoye_tob",
      "label": "傲慢少爷（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_chunzhenxuedi_tob",
      "label": "纯真学弟（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_yourougongzi_tob",
      "label": "优柔公子（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_tiexinnanyou_tob",
      "label": "贴心男友（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_shaonianjiangjun_tob",
      "label": "少年将军（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_bingjiaogege_tob",
      "label": "病娇哥哥（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_xuebanantongzhuo_tob",
      "label": "学霸男同桌（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_youmoshushu_tob",
      "label": "幽默叔叔（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_wenrounantongzhuo_tob",
      "label": "温柔男同桌（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_youmodaye_tob",
      "label": "幽默大爷（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_shenmifashi_tob",
      "label": "神秘法师（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_zh_male_lengjunshangsi_tob",
      "label": "冷峻上司（男声）",
      "tier": "1.x"
    },
    {
      "value": "ICL_en_male_michael_tob",
      "label": "Michael（美式英语男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_lubanqihao_mars_bigtts",
      "label": "鲁班七号（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_yangmi_mars_bigtts",
      "label": "林潇（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_linzhiling_mars_bigtts",
      "label": "玲玲姐姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_jiyejizi2_mars_bigtts",
      "label": "春日部姐姐（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_tangseng_mars_bigtts",
      "label": "唐僧（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_zhubajie_mars_bigtts",
      "label": "猪八戒（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_naying_mars_bigtts",
      "label": "直率英子（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_leidian_mars_bigtts",
      "label": "女雷神（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_sunwukong_mars_bigtts",
      "label": "猴哥（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_xionger_mars_bigtts",
      "label": "熊二（男声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_peiqi_mars_bigtts",
      "label": "佩奇猪（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_female_yingtaowanzi_mars_bigtts",
      "label": "樱桃丸子（女声）",
      "tier": "1.x"
    },
    {
      "value": "zh_male_silang_mars_bigtts",
      "label": "四郎（男声）",
      "tier": "1.x"
    },
    {
      "value": "multi_male_jingqiangkanye_moon_bigtts",
      "label": "かずね（和音・日语）",
      "languages": "日语、西班牙语",
      "tier": "1.x"
    },
    {
      "value": "multi_female_shuangkuaisisi_moon_bigtts",
      "label": "はるこ（晴子・日语）",
      "languages": "日语、西班牙语",
      "tier": "1.x"
    },
    {
      "value": "multi_female_gaolengyujie_moon_bigtts",
      "label": "あけみ（朱美・日语）",
      "languages": "日语",
      "tier": "1.x"
    },
    {
      "value": "multi_male_wanqudashu_moon_bigtts",
      "label": "ひろし（広志・日语）",
      "languages": "日语、西班牙语",
      "tier": "1.x"
    }
  ],
  // 百智云语音（2026-11-09）：音色 id 来自官方 `GET /openapi/v1/voices?type=tts`。
  // `speed: true` = 官方 `supports_speed_control`，只有这些音色才允许 slow/fast 预设；
  // 不声明时适配器一律不带 speed（否则服务端会 invalid_request，整句合成失败）。
  "baizhi": [
    {
      "value": "vivi",
      "label": "微澜（女声）",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "xiaohe",
      "label": "若禾（女声）",
      "languages": "中文、英语",
      "speed": true
    }
  ]
}

export function voiceOptionsFor(provider) {
  return VOICE_OPTIONS[String(provider ?? '')] ?? []
}

/**
 * 每家 TTS 厂商的默认音色（= 默认「模型」）。
 *
 * 归属约定（2026-11-08）：全局设置只负责「厂商 + 凭据」，音色是**设备级**配置
 * （`device.overrides.voice`）。设备没选时用这里的厂商默认值，所以全局条目不需要
 * （也不应该）再存音色；备用服务商同理，各自用自己厂商的默认音色。
 *
 * 火山默认必须是 2.0（`*_uranus_bigtts`）：插件默认 Resource ID 是 seed-tts-2.0，
 * 1.x 音色会被火山以 55000000 拒绝，表现是「有字没声」。
 */
export const DEFAULT_TTS_VOICES = {
  volc: 'zh_female_vv_uranus_bigtts',
  edge: 'zh-CN-XiaoxiaoNeural',
  xunfei: 'xiaoyan',
  baizhi: 'vivi'
}

/** 厂商 → 默认音色；未知厂商返回空串（交给适配器自己报缺音色）。 */
export function defaultTtsVoice(provider) {
  return DEFAULT_TTS_VOICES[String(provider ?? '')] ?? ''
}

/**
 * 把「配置里的音色」整理成适配器真正该用的音色。
 *
 * - 空串 → 本厂商默认音色；
 * - 本厂商目录里有的音色 → 原样使用；
 * - 目录里没有、但属于**别的厂商**的音色 → 回落到本厂商默认音色。典型场景是全局
 *   TTS 换了厂商，而设备 overrides.voice 还是上一家厂商的音色；直接透传会让合成报
 *   「unknown voice」，把可用链路弄成静音。
 * - 目录里没有、也不属于任何厂商 → 可能是自定义音色 ID，原样保留。
 */
export function resolveTtsVoice(provider, voice) {
  const id = String(voice ?? '').trim()
  if (!id) return defaultTtsVoice(provider)
  const catalog = voiceOptionsFor(provider)
  if (catalog.length === 0) return id
  if (catalog.some((option) => option.value === id)) return id
  for (const other of Object.keys(VOICE_OPTIONS)) {
    if (other !== provider && VOICE_OPTIONS[other].some((option) => option.value === id)) {
      return defaultTtsVoice(provider)
    }
  }
  return id
}

/**
 * 该音色是否支持 slow/fast 语速预设（目录条目 `speed: true`）。
 *
 * 只有百智云用得到：它的 `parameters.speed` 只对官方声明 `supports_speed_control` 的音色有效，
 * 不支持时服务端在扣费与合成前就回 `invalid_request`，整句直接没声音。所以「不认识/自定义
 * 音色」一律返回 false，适配器不带 speed（退化成厂商默认语速），而不是赌它支持。
 */
export function voiceSupportsSpeed(provider, voice) {
  const option = voiceOptionsFor(provider).find((item) => item.value === String(voice ?? '').trim())
  return option?.speed === true
}

/**
 * 音色属于哪一代资源族。实测（火山 2.0 账号）：
 *   seed-tts-2.0 只认 `*_uranus_bigtts` 与 `saturn_*_tob`；
 *   `*_moon_bigtts` / `*_mars_bigtts` / `*_jupiter_bigtts` / `multi_*` 会回
 *   55000000「resource ID is mismatched with speaker related resource」——表现就是
 *   「有字没声」。选了不匹配的音色，服务端在这里能提前发现。
 */
export function voiceTierOf(code) {
  const voice = VOICE_OPTIONS.volc.find((item) => item.value === code)
  return voice?.tier ?? ''
}

/** 资源 ID → 资源族。空串按插件默认的 seed-tts-2.0 处理。 */
export function resourceTierOf(resourceId) {
  const id = String(resourceId ?? '').trim() || 'seed-tts-2.0'
  if (/^seed-(tts|icl)-2/.test(id)) return '2.0'
  if (/^seed-(tts|icl)-1/.test(id)) return '1.x'
  return ''
}

/** 过滤出与资源族匹配的音色；未知音色（没 tier）一律保留。 */
export function voicesForResource(list, resourceId) {
  const tier = resourceTierOf(resourceId)
  if (!tier) return list
  const kept = list.filter((voice) => !voice.tier || voice.tier === tier)
  return kept.length > 0 ? kept : list
}
