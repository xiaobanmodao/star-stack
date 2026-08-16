// 全局聊天浮窗的触发事件（任意页面可调用 floatRoom 把聊天室弹成浮窗）
export const FLOAT_ROOM_EVENT = 'starstack:float-room'

export const floatRoom = (roomId: number) => {
  window.dispatchEvent(new CustomEvent(FLOAT_ROOM_EVENT, { detail: { roomId } }))
}
