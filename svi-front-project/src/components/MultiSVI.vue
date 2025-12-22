<template>
  <div class="container">
    <!-- 遍历并展示父组件传入的 imgList -->
    <div v-for="(item, idx) in imgList" :key="idx" class="svi-item">
      <img
        :src="item.image_url"
        :alt="`svi-${idx}`"
        class="svi-thumb"
        style="max-height: 100%; max-width: 100%; object-fit: cover;"
        @click="onImageClick(item.id, item.lat, item.lng)"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

type ImgItem = {
  id: number,
  lat: number,
  lng: number,  
  rotation: number,
  image_path: string,
  image_url: string,
  distance: number,
}

// 从父组件接收 imgList prop（对象数组）
const props = defineProps<{ imgList: ImgItem[] }>()
const emit = defineEmits(['image-click'])
// 接收 id 和 索引（以及可选的原生事件）
const onImageClick = (id: number, lat: number, lng: number) => {
  emit('image-click', id, lat, lng )
}
</script>