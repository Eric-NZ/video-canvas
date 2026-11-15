import type { CAMERA_MOVES, SHOT_SIZES } from "@/constants/storyboard";

/** 景别，取值见 SHOT_SIZES */
export type ShotSize = (typeof SHOT_SIZES)[number];

/** 运镜，取值见 CAMERA_MOVES */
export type CameraMove = (typeof CAMERA_MOVES)[number];

/**
 * 分镜表的一行镜头（PRD 分镜表节点 §6.2）。镜号不存，按行序现算，排序后不会和行错位。
 * 景别 shot、运镜 camera、画面 scene 和营销模块的 ScriptShot 同名，以后打通只需一层映射。
 */
export type StoryboardShot = {
  /** 行 id，拖拽排序和关联生成节点都靠它，复制行时换新的 */
  id: string;
  /** 画面描述：这个镜头里发生了什么 */
  scene: string;
  /** 景别，空串表示未选 */
  shot: ShotSize | "";
  /** 运镜，空串表示未选 */
  camera: CameraMove | "";
  /** 动作 / 走位：角色动作、移动路线、朝向 */
  action: string;
  /** 对白，旁白 OS / VO 也写在这里 */
  dialogue: string;
  /** 时长（秒），1–60，最多 1 位小数 */
  duration: number;
};

/** 分镜表节点自带的数据，只有 kind 为 storyboard 时才有 */
export type NodeStoryboard = {
  /** 镜头，按镜号顺序 */
  shots: StoryboardShot[];
};
