import { Compartment } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { useCollabStore } from "shared/store/collab"
import { useUserStore } from "shared/store/user"

/** y-websocket 那套消息头，服务端不解析，只有两端认 */
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const TEACHER_COLOR = "#ff6b6b"
const STUDENT_COLOR = "#4dabf7"

interface StartOptions {
  editorView: EditorView
  /**
   * 文档的初始内容。
   *
   * **学生端传当前编辑器内容，教师端必须传 null。** 这是硬规则：
   * 求助是学生发起的，学生的代码是唯一内容源。老师端插入任何初始内容都会
   * 与学生的内容合并，结果就是两份代码拼在一起 —— 老实现的竞态就是这么来的。
   */
  seedContent: string | null
}

export function useCollabDoc() {
  const collabStore = useCollabStore()
  const userStore = useUserStore()
  const compartment = new Compartment()

  let doc: any = null
  let awareness: any = null
  let view: EditorView | null = null
  let detachDocUpdate: (() => void) | null = null
  let detachAwarenessUpdate: (() => void) | null = null

  async function start({ editorView, seedContent }: StartOptions) {
    const [Y, awarenessProtocol, syncProtocol, encoding, decoding, { yCollab }] =
      await Promise.all([
        import("yjs"),
        import("y-protocols/awareness"),
        import("y-protocols/sync"),
        import("lib0/encoding"),
        import("lib0/decoding"),
        import("y-codemirror.next"),
      ])

    view = editorView
    doc = new Y.Doc()
    const ytext = doc.getText("codemirror")
    awareness = new awarenessProtocol.Awareness(doc)

    // ★ 顺序不能反：先把内容写进 ytext，再挂 yCollab。
    // yCollab 挂上去时会用 ytext 覆盖编辑器内容，先挂就会把学生的代码清空。
    if (seedContent) ytext.insert(0, seedContent)

    const send = (build: (encoder: any) => void) => {
      const encoder = encoding.createEncoder()
      build(encoder)
      collabStore.sendBinary(encoding.toUint8Array(encoder))
    }

    collabStore.setBinaryHandler((data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data))
      const messageType = decoding.readVarUint(decoder)
      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, doc, "remote")
        // 只有需要回话时才发（readSyncMessage 可能什么都没写）
        if (encoding.length(encoder) > 1) {
          collabStore.sendBinary(encoding.toUint8Array(encoder))
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          "remote",
        )
      }
    })

    const onDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin === "remote") return
      send((encoder) => {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
      })
    }
    doc.on("update", onDocUpdate)
    detachDocUpdate = () => doc?.off("update", onDocUpdate)

    const onAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: any,
    ) => {
      if (origin === "remote") return
      const changed = added.concat(updated, removed)
      send((encoder) => {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        )
      })
    }
    awareness.on("update", onAwarenessUpdate)
    detachAwarenessUpdate = () => awareness?.off("update", onAwarenessUpdate)

    awareness.setLocalStateField("user", {
      name: userStore.user?.username ?? "匿名",
      color: userStore.isTeacherOrAbove ? TEACHER_COLOR : STUDENT_COLOR,
    })

    editorView.dispatch({
      effects: compartment.reconfigure(yCollab(ytext, awareness)),
    })

    // 握手：双方都发 SyncStep1，各自回 Step2，两边收敛。
    // 服务端是哑转发，不参与同步，所以这一步必须由两端对称完成
    send((encoder) => {
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, doc)
    })
    send((encoder) => {
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
      )
    })
  }

  function stop() {
    collabStore.setBinaryHandler(null)
    detachDocUpdate?.()
    detachAwarenessUpdate?.()
    detachDocUpdate = null
    detachAwarenessUpdate = null

    if (view) {
      try {
        view.dispatch({ effects: compartment.reconfigure([]) })
      } catch (error) {
        console.warn("移除协同编辑扩展失败:", error)
      }
      view = null
    }
    awareness?.destroy()
    doc?.destroy()
    awareness = null
    doc = null
  }

  function getInitialExtension() {
    return compartment.of([])
  }

  return { start, stop, getInitialExtension }
}
