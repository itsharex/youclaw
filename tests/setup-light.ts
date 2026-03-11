/**
 * 轻量测试初始化
 *
 * 只初始化环境变量和日志，不初始化数据库
 * 用于不需要数据库的测试
 */

// 设置测试环境变量
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.DATA_DIR = '/tmp/youclaw-test-' + Date.now()
process.env.LOG_LEVEL = 'error'

import { loadEnv } from '../src/config/index.ts'
import { initLogger } from '../src/logger/index.ts'

// 初始化
loadEnv()
initLogger()
