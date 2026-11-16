/* bcryptjs 密码哈希(cost 10)。纯 JS 实现,无原生编译依赖。 */

import bcrypt from 'bcryptjs';

const COST = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
