/**
 * 音色目录 —— 全部来自各厂商**官方**清单（2026-11-14 逐家核对，不靠记忆）。
 *
 * | 厂商 | 来源 |
 * |---|---|
 * | volc（豆包 2.0） | 官方音色列表 https://docs.volcengine.com/docs/doubao-voice/tone-list-3（2026.11.06 更新） |
 * | volc（豆包 1.x） | 自建 Go 服务端 `voice_constants.go`（与官方 1.0 表一致，资源族 seed-tts-1.0） |
 * | edge | 官方 readaloud `voices/list`（实时抓取，中文 14 个） |
 * | xunfei | 官方在线语音合成发音人（vcn）；账号需在控制台添加/购买，否则报 11200 |
 * | baizhi | 官方 `GET /openapi/v1/voices?type=tts`（实时查询，10 个，全部 `supports_speed_control`） |
 * | deepseek | 官方文档 stella / tide（仅两个） |
 *
 * **只写官方确实存在的音色**：填错 id 的代价是合成失败（火山 55000000、讯飞 11200），
 * 表现是「有字没声」。加音色前先找到官方表里的那一行，不要凭印象补。
 *
 * `languages` 是音色自带属性；没有官方依据时省略该字段——宁可不显示，也不猜。
 * `tier` 只对火山有意义：`seed-tts-2.0` 只认 `*_uranus_bigtts` 与 `saturn_*_tob`。
 */

export const VOICE_OPTIONS = {
  "edge": [
    {
      "value": "zh-HK-HiuGaaiNeural",
      "label": "曉佳（女声，粤语）"
    },
    {
      "value": "zh-HK-HiuMaanNeural",
      "label": "曉曼（女声，粤语）"
    },
    {
      "value": "zh-HK-WanLungNeural",
      "label": "雲龍（男声，粤语）"
    },
    {
      "value": "zh-CN-XiaoxiaoNeural",
      "label": "晓晓（女声，普通话）"
    },
    {
      "value": "zh-CN-XiaoyiNeural",
      "label": "晓伊（女声，普通话）"
    },
    {
      "value": "zh-CN-YunjianNeural",
      "label": "云健（男声，普通话/体育解说）"
    },
    {
      "value": "zh-CN-YunxiNeural",
      "label": "云希（男声，普通话）"
    },
    {
      "value": "zh-CN-YunxiaNeural",
      "label": "云夏（男声，普通话/少年）"
    },
    {
      "value": "zh-CN-YunyangNeural",
      "label": "云扬（男声，普通话/新闻播报）"
    },
    {
      "value": "zh-CN-liaoning-XiaobeiNeural",
      "label": "晓北（女声，东北话）"
    },
    {
      "value": "zh-TW-HsiaoChenNeural",
      "label": "曉臻（女声，台湾国语）"
    },
    {
      "value": "zh-TW-YunJheNeural",
      "label": "雲哲（男声，台湾国语）"
    },
    {
      "value": "zh-TW-HsiaoYuNeural",
      "label": "曉雨（女声，台湾国语）"
    },
    {
      "value": "zh-CN-shaanxi-XiaoniNeural",
      "label": "晓妮（女声，陕西话）"
    }
  ],
  // 讯飞（2026-11-14 核对）：vcn 取自官方在线语音合成发音人表；官方没有「列发音人」
  // 的公开接口，**每个发音人都要在控制台添加/购买**，没开通时服务端回 11200（授权错误）。
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
  // 火山：2.0（官方 zh/en `*_uranus_bigtts` 全表）在前，1.x（legacy，需 seed-tts-1.0）在后。
  // 控制台按资源族过滤（`voicesForResource`），默认 seed-tts-2.0 只会显示 2.0 那一段。
  "volc": [
    {
      "value": "zh_female_tuanzi_uranus_bigtts",
      "label": "团子 2.0",
      "languages": "中文",
      "tier": "2.0"
    },
    {
      "value": "zh_female_vv_uranus_bigtts",
      "label": "Vivi 2.0",
      "languages": "中文、日文、印尼、墨西哥西班牙语、支持30+语种识别；方言：粤语、上海、河南、北京、天津、四川、陕西、东北",
      "tier": "2.0"
    },
    {
      "value": "zh_female_xiaohe_uranus_bigtts",
      "label": "小何 2.0",
      "languages": "中文、支持30+语种识别；方言：粤语、上海、河南、北京、天津、四川、陕西、东北",
      "tier": "2.0"
    },
    {
      "value": "zh_male_m191_uranus_bigtts",
      "label": "云舟 2.0",
      "languages": "中文、支持30+语种识别；方言：粤语、上海、河南、北京、天津、四川、陕西、东北",
      "tier": "2.0"
    },
    {
      "value": "zh_male_taocheng_uranus_bigtts",
      "label": "小天 2.0",
      "languages": "中文、支持30+语种识别；方言：粤语、上海、河南、北京、天津、四川、陕西、东北",
      "tier": "2.0"
    },
    {
      "value": "zh_male_liufei_uranus_bigtts",
      "label": "刘飞 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_sophie_uranus_bigtts",
      "label": "魅力苏菲 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_qingxinnvsheng_uranus_bigtts",
      "label": "清新女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_cancan_uranus_bigtts",
      "label": "知性灿灿 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_sajiaoxuemei_uranus_bigtts",
      "label": "撒娇学妹 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tianmeixiaoyuan_uranus_bigtts",
      "label": "甜美小源 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tianmeitaozi_uranus_bigtts",
      "label": "甜美桃子 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_shuangkuaisisi_uranus_bigtts",
      "label": "爽快思思 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_peiqi_uranus_bigtts",
      "label": "佩奇猪 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_linjianvhai_uranus_bigtts",
      "label": "邻家女孩 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_shaonianzixin_uranus_bigtts",
      "label": "少年梓辛 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_sunwukong_uranus_bigtts",
      "label": "猴哥 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_yingyujiaoxue_uranus_bigtts",
      "label": "Tina老师 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_kefunvsheng_uranus_bigtts",
      "label": "暖阳女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_xiaoxue_uranus_bigtts",
      "label": "儿童绘本 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_dayi_uranus_bigtts",
      "label": "大壹 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_mizai_uranus_bigtts",
      "label": "黑猫侦探社咪仔 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_jitangnv_uranus_bigtts",
      "label": "鸡汤女 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_meilinvyou_uranus_bigtts",
      "label": "魅力女友 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_liuchangnv_uranus_bigtts",
      "label": "流畅女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_ruyayichen_uranus_bigtts",
      "label": "儒雅逸辰 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "en_male_tim_uranus_bigtts",
      "label": "Tim",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_dacey_uranus_bigtts",
      "label": "Dacey",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_stokie_uranus_bigtts",
      "label": "Stokie",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "zh_female_wenroumama_uranus_bigtts",
      "label": "温柔妈妈 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_jieshuoxiaoming_uranus_bigtts",
      "label": "解说小明 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tvbnv_uranus_bigtts",
      "label": "TVB女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_yizhipiannan_uranus_bigtts",
      "label": "译制片男 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_qiaopinv_uranus_bigtts",
      "label": "俏皮女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_zhishuaiyingzi_uranus_bigtts",
      "label": "直率英子 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_linjiananhai_uranus_bigtts",
      "label": "邻家男孩 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_silang_uranus_bigtts",
      "label": "四郎 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_ruyaqingnian_uranus_bigtts",
      "label": "儒雅青年 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_qingcang_uranus_bigtts",
      "label": "擎苍 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_xionger_uranus_bigtts",
      "label": "熊二 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_yingtaowanzi_uranus_bigtts",
      "label": "樱桃丸子 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_wennuanahu_uranus_bigtts",
      "label": "温暖阿虎 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_naiqimengwa_uranus_bigtts",
      "label": "奶气萌娃 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_popo_uranus_bigtts",
      "label": "婆婆 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_gaolengyujie_uranus_bigtts",
      "label": "高冷御姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_aojiaobazong_uranus_bigtts",
      "label": "傲娇霸总 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_lanyinmianbao_uranus_bigtts",
      "label": "懒音绵宝 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_fanjuanqingnian_uranus_bigtts",
      "label": "反卷青年 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_wenroushunv_uranus_bigtts",
      "label": "温柔淑女 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_gufengshaoyu_uranus_bigtts",
      "label": "古风少御 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_huolixiaoge_uranus_bigtts",
      "label": "活力小哥 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_baqiqingshu_uranus_bigtts",
      "label": "霸气青叔 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_xuanyijieshuo_uranus_bigtts",
      "label": "悬疑解说 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_mengyatou_uranus_bigtts",
      "label": "萌丫头 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tiexinnvsheng_uranus_bigtts",
      "label": "贴心女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_jitangmei_uranus_bigtts",
      "label": "鸡汤妹妹 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_cixingjieshuonan_uranus_bigtts",
      "label": "磁性解说男声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_liangsangmengzai_uranus_bigtts",
      "label": "亮嗓萌仔 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_kailangjiejie_uranus_bigtts",
      "label": "开朗姐姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_gaolengchenwen_uranus_bigtts",
      "label": "高冷沉稳 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_shenyeboke_uranus_bigtts",
      "label": "深夜播客 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_lubanqihao_uranus_bigtts",
      "label": "鲁班七号 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_jiaochuannv_uranus_bigtts",
      "label": "娇喘女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_linxiao_uranus_bigtts",
      "label": "林潇 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_lingling_uranus_bigtts",
      "label": "玲玲姐姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_chunribu_uranus_bigtts",
      "label": "春日部姐姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_tangseng_uranus_bigtts",
      "label": "唐僧 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_zhuangzhou_uranus_bigtts",
      "label": "庄周 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_kailangdidi_uranus_bigtts",
      "label": "开朗弟弟 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_zhubajie_uranus_bigtts",
      "label": "猪八戒 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_ganmaodianyin_uranus_bigtts",
      "label": "感冒电音姐姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_chanmeinv_uranus_bigtts",
      "label": "谄媚女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_nvleishen_uranus_bigtts",
      "label": "女雷神 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_qinqienv_uranus_bigtts",
      "label": "亲切女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_kuailexiaodong_uranus_bigtts",
      "label": "快乐小东 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_kailangxuezhang_uranus_bigtts",
      "label": "开朗学长 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_youyoujunzi_uranus_bigtts",
      "label": "悠悠君子 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_wenjingmaomao_uranus_bigtts",
      "label": "文静毛毛 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_zhixingnv_uranus_bigtts",
      "label": "知性女声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_qingshuangnanda_uranus_bigtts",
      "label": "清爽男大 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_yuanboxiaoshu_uranus_bigtts",
      "label": "渊博小叔 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_yangguangqingnian_uranus_bigtts",
      "label": "阳光青年 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_qingchezizi_uranus_bigtts",
      "label": "清澈梓梓 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_tianmeiyueyue_uranus_bigtts",
      "label": "甜美悦悦 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_xinlingjitang_uranus_bigtts",
      "label": "心灵鸡汤 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_wenrouxiaoge_uranus_bigtts",
      "label": "温柔小哥 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_roumeinvyou_uranus_bigtts",
      "label": "柔美女友 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_dongfanghaoran_uranus_bigtts",
      "label": "东方浩然 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_wenrouxiaoya_uranus_bigtts",
      "label": "温柔小雅 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_tiancaitongsheng_uranus_bigtts",
      "label": "天才童声 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_wuzetian_uranus_bigtts",
      "label": "武则天 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_gujie_uranus_bigtts",
      "label": "顾姐 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_male_guanggaojieshuo_uranus_bigtts",
      "label": "广告解说 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "zh_female_shaoergushi_uranus_bigtts",
      "label": "少儿故事 2.0",
      "languages": "中文、支持30+语种识别",
      "tier": "2.0"
    },
    {
      "value": "en_male_ryan_uranus_bigtts",
      "label": "Ryan",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_alberto_uranus_bigtts",
      "label": "Alberto",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_alex_uranus_bigtts",
      "label": "Alex",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_allison_uranus_bigtts",
      "label": "Allison",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_bill_jones_corey_uranus_bigtts",
      "label": "Bill",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_brad_pitt_p1_uranus_bigtts",
      "label": "Brad_Pitt",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_brittney_uranus_bigtts",
      "label": "Brittney",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_brittney_pimintel_uranus_bigtts",
      "label": "Zoe",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_bruce_uranus_bigtts",
      "label": "Adrian",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_chandler_p1_uranus_bigtts",
      "label": "Leo",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_cowboy_john_b_uranus_bigtts",
      "label": "John",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_david_uranus_bigtts",
      "label": "David",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_diyuwenrounan_uranus_bigtts",
      "label": "Julian",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_godfather_uranus_bigtts",
      "label": "Godfather",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_gollum_uranus_bigtts",
      "label": "Gollum",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_hades_uranus_bigtts",
      "label": "Beau",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_hayley_uranus_bigtts",
      "label": "Hayley",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_jamie_uranus_bigtts",
      "label": "Jamie",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_jane_uranus_bigtts",
      "label": "Jane",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_jenny_uranus_bigtts",
      "label": "Jenny",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_jidongchuanjiaoshi_uranus_bigtts",
      "label": "Blaze",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_jimmy_uranus_bigtts",
      "label": "Jimmy",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_joanne_uranus_bigtts",
      "label": "Joanne",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_joker_uranus_bigtts",
      "label": "Joker",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_josh_uranus_bigtts",
      "label": "Josh",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_josh_coery_uranus_bigtts",
      "label": "Josiah",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_kevin_uranus_bigtts",
      "label": "Kevin",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_knightley_uranus_bigtts",
      "label": "Knightley",
      "languages": "英语（美式）",
      "tier": "2.0"
    },
    {
      "value": "en_female_lana_del_rey_kelley_d_p1_uranus_bigtts",
      "label": "Lynn",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_lana_del_rey_parky_s_p1_uranus_bigtts",
      "label": "Ivy",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_marcus_uranus_bigtts",
      "label": "Marcus",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_mel_uranus_bigtts",
      "label": "Mel",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_michael_uranus_bigtts",
      "label": "Hank",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_michael_kevin_uranus_bigtts",
      "label": "Michael_Kevin",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_myra_uranus_bigtts",
      "label": "Myra",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_myra_cmb_uranus_bigtts",
      "label": "Sunny",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_nadia_uranus_bigtts",
      "label": "Blair",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_natasha_uranus_bigtts",
      "label": "Natasha",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_rachel_p1_uranus_bigtts",
      "label": "Rachel",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_ronald_uranus_bigtts",
      "label": "Ronald",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_russell_uranus_bigtts",
      "label": "Russell",
      "languages": "英语（美式）",
      "tier": "2.0"
    },
    {
      "value": "en_female_scarlet_p1_uranus_bigtts",
      "label": "Scarlet",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_sharron_uranus_bigtts",
      "label": "Sharron",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_simba_p1_uranus_bigtts",
      "label": "Simba",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_skye_uranus_bigtts",
      "label": "Skye",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_tom_hiddleston_p1_uranus_bigtts",
      "label": "Tom",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_valentino_uranus_bigtts",
      "label": "Valentino",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_valentino_corey_uranus_bigtts",
      "label": "Clark",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_wenrouzhishijieshuonv_uranus_bigtts",
      "label": "Megan",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_xinwenjieshuonv_uranus_bigtts",
      "label": "Kayla",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_male_yangguangjieshuonan_uranus_bigtts",
      "label": "Dylan",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "en_female_zendaya_p1_uranus_bigtts",
      "label": "Zendaya",
      "languages": "美式英语",
      "tier": "2.0"
    },
    {
      "value": "zh_female_cancan_mars_bigtts",
      "label": "灿灿 / Shiny（女声）",
      "languages": "中文、美式英语",
      "tier": "1.x"
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
      "label": "微澜",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "xiaohe",
      "label": "若禾",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "cancan",
      "label": "知夏",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "liufei",
      "label": "逸飞",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "qingxin",
      "label": "清歌",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "sophie",
      "label": "苏晴",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "xiaotian",
      "label": "朗天",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "yichen",
      "label": "砚舟",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "yunzhou",
      "label": "景舟",
      "languages": "中文、英语",
      "speed": true
    },
    {
      "value": "zixin",
      "label": "梓辰",
      "languages": "中文、英语",
      "speed": true
    }
  ],
  // DeepSeek 语音合成（2026-11-14）：官方只有两个音色，没有语种参数（按文本自动识别），
  // 也不支持调节语速（因此不声明 `speed`）。语种覆盖见官方「语音合成指南」。
  "deepseek": [
    {
      "value": "stella",
      "label": "海星（女声）",
      "languages": "中文、粤语、英语、日语、韩语等（自动识别）"
    },
    {
      "value": "tide",
      "label": "暗潮（男声）",
      "languages": "中文、粤语、英语、日语、韩语等（自动识别）"
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
  baizhi: 'vivi',
  deepseek: 'stella'
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
  if (voice) return voice.tier
  // 目录外的自定义 id（手写 settings、官方新增音色）：按命名规则判断。只认实测过的两族——
  // `seed-tts-2.0` 接受 `*_uranus_bigtts` / `*_saturn_bigtts` / `saturn_*_tob`，其余按 1.x 处理。
  // 注意：这只是**给资源族过滤**用的兜底，不代表该 id 一定有效；真正的验证只能靠一次合成。
  const id = String(code ?? '').trim()
  if (/_uranus_bigtts$/.test(id) || /_saturn_bigtts$/.test(id) || /^saturn_.*_tob$/.test(id)) return '2.0'
  if (/_moon_bigtts$|_mars_bigtts$|_jupiter_bigtts$/.test(id) || /^multi_/.test(id)) return '1.x'
  return ''
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
