import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import { uploadAsset } from "@/api/asset";
import type { CanvasEdge, CanvasNode } from "@/types";
import { applyShotUpload, emptyStoryboard, removeShotImage } from "@/utils/storyboard/shots";
import { firstImageFile, takeShotImageFile } from "@/utils/storyboard/upload";

/** 上传中的状态：哪一行、传了多少 */
export type ShotUpload = { shotId: string; progress: number };

/**
 * 分镜图的手动上传（PRD 6.5、AC9）：点击选文件和拖入共用一条路径，上传中显示进度，传完写回这一行
 * 并解除和图片节点的关联；失败（格式、大小、网络）这一格回到原状，toast 说明原因。
 * 一次只传一张，上传中再来一张直接忽略；上传期间这一行被删了不写回。
 * @param storyboardId 分镜表节点 id
 */
export function useShotImageUpload(storyboardId: string) {
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const [upload, setUpload] = useState<ShotUpload | null>(null);
  // 上传是异步的：用 ref 挡住并发，state 只管显示
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const uploadFile = useCallback(
    async (shotId: string, file: File) => {
      if (running.current) return;
      const check = takeShotImageFile(file);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      running.current = true;
      setUpload({ shotId, progress: 0 });
      try {
        const asset = await uploadAsset(file, {
          onProgress: (progress) => {
            if (mounted.current) setUpload({ shotId, progress });
          },
        });
        updateNodeData(storyboardId, (node) => ({
          storyboard: applyShotUpload(node.data.storyboard ?? emptyStoryboard(), shotId, asset),
        }));
      } catch {
        // 上传失败的全局提示由请求层统一弹，这一格回到原状
      } finally {
        running.current = false;
        if (mounted.current) setUpload(null);
      }
    },
    [storyboardId, updateNodeData],
  );

  /** 点「上传分镜图」：临时建一个文件输入框选图，选完上传（不挂进页面，不用持有元素的 ref） */
  const pickFile = useCallback(
    (shotId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) void uploadFile(shotId, file);
      };
      input.click();
    },
    [uploadFile],
  );

  /** 拖进来的一批文件：取第一张图片上传，没有图片就不理 */
  const dropFiles = useCallback(
    (shotId: string, files: Iterable<File>) => {
      const file = firstImageFile(files);
      if (file) void uploadFile(shotId, file);
    },
    [uploadFile],
  );

  /** 移除手传的图 */
  const removeImage = useCallback(
    (shotId: string) =>
      updateNodeData(storyboardId, (node) => ({
        storyboard: removeShotImage(node.data.storyboard ?? emptyStoryboard(), shotId),
      })),
    [storyboardId, updateNodeData],
  );

  return { upload, pickFile, dropFiles, removeImage };
}
