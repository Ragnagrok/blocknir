/** three.js rendering: voxel meshing, scenes, rigged figures and the view with postprocessing. */
export { meshVoxels, type MeshData, type MeshOptions, type VoxelMeshData } from './mesher.js';
export { emissiveMaterial, forgetMesh, instantiate, solidMaterial, VoxelMesh } from './voxel-mesh.js';
export {
  buildScene,
  createLight,
  flickerAt,
  placeInstance,
  placeModel,
  type BuiltScene,
  type LiveLight,
} from './scene.js';
export { Figure3D } from './figure.js';
export { glowSprite, View } from './view.js';
