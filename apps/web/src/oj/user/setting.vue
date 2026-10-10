<script setup lang="ts">
import { MOOD_MAX } from "@oj2/contract"
import { updateProfile, uploadAvatar } from "oj/api"
import { useUserStore } from "shared/store/user"

const userStore = useUserStore()
const message = useMessage()

async function beforeUpload(data: { file: UploadFileInfo; fileList: UploadFileInfo[] }) {
  if (!data.file.file) return false
  if (data.file.file.size > 2 * 1024 * 1024) {
    message.warning("图片太大啦！不能超过 2 MB 啊")
    return false
  }
  return true
}

async function upload({ file }: UploadCustomRequestOptions) {
  try {
    await uploadAvatar(file.file!)
    message.success("上传成功")
    userStore.getMyProfile()
  } catch (err) {
    message.error("上传失败")
  }
}

async function saveProfile() {
  // 以前限 256 字，老的长签名还在库里：输入框挡不住已有的字，存之前先说清楚
  const length = userStore.profile?.mood?.trim().length ?? 0
  if (length > MOOD_MAX) {
    message.warning(`个性签名最多 ${MOOD_MAX} 个字，现在有 ${length} 个，删短一点再保存`)
    return
  }
  try {
    await updateProfile({
      realName: userStore.profile?.realName ?? "",
      mood: userStore.profile?.mood ?? "",
    })
    message.success("更改成功")
  } catch (err) {
    message.error("更改失败")
  }
}
</script>
<template>
  <n-flex class="container" vertical v-if="userStore.profile">
    <h3>个人信息设置</h3>
    <n-form>
      <n-avatar round :size="120" :src="userStore.profile.avatar" alt="头像" />
      <n-form-item label="">
        <n-upload
          :show-file-list="false"
          accept="image/*"
          @before-upload="beforeUpload"
          :custom-request="upload"
        >
          <n-button>上传头像</n-button>
        </n-upload>
      </n-form-item>
      <!-- <n-form-item label="真名">
        <n-input v-model:value="userStore.profile.realName" />
      </n-form-item> -->
      <n-form-item label="个性签名">
        <n-input
          v-model:value="userStore.profile.mood"
          :maxlength="MOOD_MAX"
          show-count
          placeholder="会显示在排名和个人主页上"
        />
      </n-form-item>
      <n-button @click="saveProfile">更改信息</n-button>
    </n-form>
  </n-flex>
</template>
<style scoped>
.container {
  max-width: 600px;
  margin: 0 auto;
}

h3 {
  font-weight: normal;
}
</style>
