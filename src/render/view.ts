import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Final lens pass: slight chromatic aberration, vignette, rounded corners and film grain. */
const FINISH = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 16 / 9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float aspect;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float ab = dot(c, c) * 0.0035;
      vec3 color = vec3(
        texture2D(tDiffuse, vUv + c * ab).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - c * ab).b
      );
      vec2 d = c * vec2(aspect / 1.6, 1.0);
      color *= smoothstep(0.95, 0.3, length(d));
      vec2 corner = abs(c) - vec2(0.485);
      color *= 1.0 - smoothstep(0.0, 0.012, length(max(corner, 0.0)));
      color += (hash(vUv) - 0.5) * 0.028;
      gl_FragColor = vec4(color, 1.0);
    }`,
};

let glowTexture: THREE.Texture | null = null;

/** Soft additive glow around a light source. `size` in meters. Needs a DOM (draws on a canvas once). */
export function glowSprite(color: number, size: number): THREE.Sprite {
  if (!glowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  s.scale.setScalar(size);
  return s;
}

/** Renderer, scene and camera with shadows, ACES tone mapping, bloom and a lens finish pass. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 80);
  private composer: EffectComposer;
  private finish: ShaderPass;
  private bloom: UnrealBloomPass;

  /** `preserveDrawingBuffer` keeps the last frame readable (screenshots, thumbnails). */
  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.7, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FINISH);
    this.composer.addPass(this.finish);
  }

  /** Sets the drawing size in CSS pixels. `maxPixelRatio` caps pixel density; lower it on phones. */
  resize(width: number, height: number, maxPixelRatio = 2): void {
    const ratio = Math.min(window.devicePixelRatio, maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.finish.uniforms.aspect!.value = width / height;
  }

  /** Draws a frame. `time` in seconds animates the film grain. */
  render(time: number): void {
    this.finish.uniforms.time!.value = time % 10;
    this.composer.render();
  }
}
