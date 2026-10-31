/**
 * 密码模块入口：实现见 password-core.ts
 * （拆分为两部分是为了让 Prisma seed 脚本与 Next.js 应用共用同一份实现。）
 */
export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateFillPassword,
  SCRYPT_PARAMS,
  KEY_LEN,
} from './password-core';
