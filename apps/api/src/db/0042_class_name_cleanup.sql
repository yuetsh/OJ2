-- 2026-11 班级不再从用户名的 ks 前缀推出来，改成建号时明确给。两个老号当年被推成了不是班号的班级
-- （ksxrm → 'xrm'，ks王仁杰2 → '王仁杰'），任何班级下拉都选不到它们，后台一编辑还会被班号校验挡住，
-- 改成没填班级。只动不是 3～4 位数字的，正常的班一行不碰
UPDATE "user" SET "class_name" = NULL WHERE "class_name" IS NOT NULL AND "class_name" !~ '^[0-9]{3,4}$';
