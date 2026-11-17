"use client"

import { Html, Line, OrbitControls, Grid } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import * as React from "react"
import * as THREE from "three"
import type { z } from "zod"

import type { scene3dObject, show3dInput } from "@/lib/agent/schemas"
import { loadMath, normalizeExpr } from "@/lib/math-client"

type SceneSpec = z.infer<typeof show3dInput>
type Obj = z.infer<typeof scene3dObject>
type V3 = [number, number, number]

const v3 = (v: number[] | undefined, d: V3 = [0, 0, 0]): V3 =>
  v && v.length === 3 && v.every(Number.isFinite) ? (v as V3) : d
const rad = (deg: V3): V3 => deg.map((d) => (d * Math.PI) / 180) as V3
const DEFAULT_COLOR = "#7c3aed"

function Label({ text, position }: { text: string; position: V3 }) {
  return (
    <Html position={position} center zIndexRange={[20, 0]}>
      <div className="pointer-events-none rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-border backdrop-blur">
        {text}
      </div>
    </Html>
  )
}

/** Spin / orbit animation wrapper. */
function Animated({ obj, children }: { obj: Obj; children: React.ReactNode }) {
  const ref = React.useRef<THREE.Group>(null)
  const t = React.useRef(obj.orbit ? obj.orbit.radius * 1.7 : 0) // deterministic start phase
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    if (obj.spin) g.rotation.y += obj.spin * dt
    if (obj.orbit) {
      t.current += obj.orbit.speed * dt
      const [cx, cy, cz] = v3(obj.orbit.center)
      g.position.set(cx + Math.cos(t.current) * obj.orbit.radius, cy, cz + Math.sin(t.current) * obj.orbit.radius)
    }
  })
  return <group ref={ref}>{children}</group>
}

function useSurface(obj: Obj) {
  const [geometry, setGeometry] = React.useState<THREE.BufferGeometry | null>(null)
  React.useEffect(() => {
    if (obj.kind !== "surface" || !obj.expr) return
    let cancelled = false
    loadMath().then(({ compile }) => {
      try {
        const f = compile(normalizeExpr(obj.expr!))
        const { min = -3, max = 3 } = obj.range ?? {}
        const N = 60
        const positions: number[] = []
        const indices: number[] = []
        for (let i = 0; i <= N; i++) {
          for (let j = 0; j <= N; j++) {
            const x = min + ((max - min) * i) / N
            const z = min + ((max - min) * j) / N
            let y = Number(f.evaluate({ x, z, y: z }))
            if (!Number.isFinite(y)) y = 0
            positions.push(x, Math.max(-50, Math.min(50, y)), z)
          }
        }
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const a = i * (N + 1) + j
            const b = a + N + 1
            indices.push(a, b, a + 1, b, b + 1, a + 1)
          }
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
        g.setIndex(indices)
        g.computeVertexNormals()
        if (!cancelled) setGeometry(g)
      } catch {
        /* bad expression: render nothing */
      }
    })
    return () => {
      cancelled = true
    }
  }, [obj.kind, obj.expr, obj.range])
  return geometry
}

function useCurve(obj: Obj) {
  const [points, setPoints] = React.useState<V3[] | null>(null)
  React.useEffect(() => {
    if (obj.kind !== "curve" || !obj.expr) return
    let cancelled = false
    loadMath().then(({ compile }) => {
      try {
        const f = compile(normalizeExpr(obj.expr!))
        const { min = 0, max = Math.PI * 4 } = obj.range ?? {}
        const out: V3[] = []
        for (let i = 0; i <= 300; i++) {
          const t = min + ((max - min) * i) / 300
          const r = f.evaluate({ t })
          const arr = (typeof r?.toArray === "function" ? r.toArray() : r) as number[]
          if (Array.isArray(arr) && arr.length === 3 && arr.every((n) => Number.isFinite(Number(n)))) {
            out.push(arr.map(Number) as V3)
          }
        }
        if (!cancelled && out.length > 1) setPoints(out)
      } catch {
        /* ignore */
      }
    })
    return () => {
      cancelled = true
    }
  }, [obj.kind, obj.expr, obj.range])
  return points
}

function SceneObject({ obj }: { obj: Obj }) {
  const color = obj.color ?? DEFAULT_COLOR
  const position = v3(obj.position)
  const rotation = rad(v3(obj.rotation))
  const s = obj.size ?? 1
  const transparent = obj.opacity !== undefined && obj.opacity < 1
  const material = (
    <meshStandardMaterial
      color={color}
      transparent={transparent}
      opacity={obj.opacity ?? 1}
      wireframe={obj.wireframe}
      roughness={0.45}
      metalness={0.05}
      side={THREE.DoubleSide}
    />
  )
  const surface = useSurface(obj)
  const curve = useCurve(obj)

  let body: React.ReactNode = null
  let labelAt: V3 = [position[0], position[1] + s * 1.3, position[2]]

  switch (obj.kind) {
    case "sphere":
      body = (
        <mesh position={position} rotation={rotation}>
          <sphereGeometry args={[s, 48, 32]} />
          {material}
        </mesh>
      )
      break
    case "box": {
      const d = v3(obj.dims, [s, s, s])
      body = (
        <mesh position={position} rotation={rotation}>
          <boxGeometry args={d} />
          {material}
        </mesh>
      )
      labelAt = [position[0], position[1] + d[1] / 2 + 0.4, position[2]]
      break
    }
    case "cylinder": {
      const [r, h] = v3(obj.dims, [s, s * 2, 0])
      body = (
        <mesh position={position} rotation={rotation}>
          <cylinderGeometry args={[r, r, h, 48]} />
          {material}
        </mesh>
      )
      labelAt = [position[0], position[1] + h / 2 + 0.4, position[2]]
      break
    }
    case "cone": {
      const [r, h] = v3(obj.dims, [s, s * 2, 0])
      body = (
        <mesh position={position} rotation={rotation}>
          <coneGeometry args={[r, h, 48]} />
          {material}
        </mesh>
      )
      labelAt = [position[0], position[1] + h / 2 + 0.4, position[2]]
      break
    }
    case "torus":
      body = (
        <mesh position={position} rotation={rotation}>
          <torusGeometry args={[s, s * 0.28, 24, 96]} />
          {material}
        </mesh>
      )
      break
    case "plane":
      body = (
        <mesh position={position} rotation={obj.rotation ? rotation : [-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[s, s]} />
          {material}
        </mesh>
      )
      break
    case "point":
      body = (
        <mesh position={position}>
          <sphereGeometry args={[obj.size ?? 0.08, 16, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )
      labelAt = [position[0], position[1] + 0.3, position[2]]
      break
    case "vector": {
      const from = new THREE.Vector3(...v3(obj.from, position))
      const to = new THREE.Vector3(...v3(obj.to, [1, 0, 0]))
      const dir = to.clone().sub(from)
      const len = dir.length() || 1
      const arrow = new THREE.ArrowHelper(dir.normalize(), from, len, new THREE.Color(color), Math.min(0.35, len * 0.25), Math.min(0.2, len * 0.15))
      body = <primitive object={arrow} />
      labelAt = [to.x, to.y + 0.3, to.z]
      break
    }
    case "line": {
      const pts = obj.points?.length ? obj.points.map((p) => v3(p)) : [v3(obj.from), v3(obj.to, [1, 0, 0])]
      body = <Line points={pts} color={color} lineWidth={2.5} />
      labelAt = pts.at(-1) ?? position
      break
    }
    case "curve":
      body = curve ? <Line points={curve} color={color} lineWidth={2.5} /> : null
      labelAt = curve?.at(-1) ?? position
      break
    case "surface":
      body = surface ? (
        <mesh geometry={surface} position={position}>
          <meshStandardMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent={transparent}
            opacity={obj.opacity ?? 0.92}
            wireframe={obj.wireframe}
            roughness={0.6}
          />
        </mesh>
      ) : null
      break
    case "label":
      return obj.label ? <Label text={obj.label} position={position} /> : null
  }

  const content = (
    <>
      {body}
      {obj.label ? <Label text={obj.label} position={labelAt} /> : null}
    </>
  )
  return obj.spin || obj.orbit ? <Animated obj={obj}>{content}</Animated> : content
}

/** Bounding sphere of the scene, so the camera can frame small (molecules) and large (orbits) scenes alike. */
function sceneBounds(objects: Obj[]) {
  const pts: { p: V3; r: number }[] = []
  for (const o of objects) {
    const r = o.orbit ? o.orbit.radius + (o.size ?? 0.3) : (o.size ?? (o.kind === "surface" ? 0 : 0.5))
    if (o.orbit) pts.push({ p: v3(o.orbit.center), r })
    else if (o.kind === "surface") {
      const { min = -3, max = 3 } = o.range ?? {}
      pts.push({ p: [(min + max) / 2, 0, (min + max) / 2], r: ((max - min) / 2) * 1.5 })
    } else pts.push({ p: v3(o.position), r })
    for (const q of [o.from, o.to, ...(o.points ?? [])]) if (q) pts.push({ p: v3(q), r: 0.1 })
  }
  if (!pts.length) return { center: [0, 0, 0] as V3, radius: 3 }
  const c = [0, 1, 2].map((i) => pts.reduce((s, x) => s + x.p[i], 0) / pts.length) as V3
  const radius = Math.max(0.8, ...pts.map((x) => Math.hypot(x.p[0] - c[0], x.p[1] - c[1], x.p[2] - c[2]) + x.r))
  return { center: c, radius }
}

export default function Scene3D({ spec, interactive = true }: { spec: Partial<SceneSpec>; interactive?: boolean }) {
  const objects = (spec.objects ?? []).filter((o): o is Obj => !!o?.kind)
  const { center, radius } = sceneBounds(objects)
  const dist = radius * 3.1
  const camera = v3(spec.camera, [center[0] + dist * 0.62, center[1] + dist * 0.45, center[2] + dist * 0.65])
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark")

  return (
    <Canvas camera={{ position: camera, fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} />
      <directionalLight position={[-6, -4, -6]} intensity={0.35} />
      {spec.showGrid !== false ? (
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2}
          fadeDistance={30}
          cellColor={dark ? "#3a3936" : "#e2e0da"}
          sectionColor={dark ? "#55534e" : "#c9c6bd"}
          position={[0, -0.001, 0]}
        />
      ) : null}
      {spec.showAxes ? (
        <>
          <axesHelper args={[4]} />
          <Label text="x" position={[4.3, 0, 0]} />
          <Label text="y" position={[0, 4.3, 0]} />
          <Label text="z" position={[0, 0, 4.3]} />
        </>
      ) : null}
      {objects.map((o, i) => (
        <SceneObject key={i} obj={o} />
      ))}
      <OrbitControls
        makeDefault
        target={spec.camera ? [0, 0, 0] : center}
        enableDamping
        autoRotate={!!spec.autoRotate}
        autoRotateSpeed={0.8}
        enableZoom={interactive}
      />
    </Canvas>
  )
}
