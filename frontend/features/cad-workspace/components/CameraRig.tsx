'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  activeParameter: string | null;
  annotations: Record<string, any>;
  geometryInfo: {
    center: [number, number, number];
    scale: number;
    size?: [number, number, number];
  } | null;
}

export function CameraRig({ activeParameter, annotations, geometryInfo }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as any;
  const viewportSize = useThree((state) => state.size);
  const aspect = viewportSize.width / viewportSize.height;
  
  // Track target vectors locally across frames
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const targetCamPos = useRef(new THREE.Vector3(5, 5, 5));

  // Capture starting state for interpolation
  const startLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const startCamPos = useRef(new THREE.Vector3(5, 5, 5));
  const isTransitioning = useRef(false);
  const startTime = useRef(0);

  useEffect(() => {
    let lookAtDest = new THREE.Vector3(0, 0, 0);
    let camPosDest = new THREE.Vector3(5, 5, 5);

    if (activeParameter && annotations[activeParameter]) {
      const annotation = annotations[activeParameter];
      const type = annotation.type || (annotation.p1 && annotation.p2 ? 'height' : (annotation.center ? 'diameter' : 'height'));

      const scale = geometryInfo?.scale ?? 1.0;
      const center = geometryInfo?.center ?? [0, 0, 0];

      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const featureCenter = new THREE.Vector3();

      if (type === 'diameter' || type === 'chamfer') {
        const c = annotation.center || [0, 0, 0];
        featureCenter.set(
          (c[0] - center[0]) * scale,
          (c[1] - center[1]) * scale,
          (c[2] - center[2]) * scale
        );
        const val = type === 'diameter'
          ? (annotation.value || (annotation.radius ? annotation.radius * 2 : 10.0))
          : (annotation.radius || 10.0);
        const r = (val / 2) * scale;
        p1.copy(featureCenter).add(new THREE.Vector3(-r, 0, 0));
        p2.copy(featureCenter).add(new THREE.Vector3(r, 0, 0));
      } else {
        const rawP1 = annotation.p1 || [0, 0, 0];
        const rawP2 = annotation.p2 || [0, 0, 0];
        p1.set(
          (rawP1[0] - center[0]) * scale,
          (rawP1[1] - center[1]) * scale,
          (rawP1[2] - center[2]) * scale
        );
        p2.set(
          (rawP2[0] - center[0]) * scale,
          (rawP2[1] - center[1]) * scale,
          (rawP2[2] - center[2]) * scale
        );
        featureCenter.addVectors(p1, p2).multiplyScalar(0.5);
      }

      lookAtDest.copy(featureCenter);

      const distance = p1.distanceTo(p2);
      let zoomOffset = Math.max(distance * 2.5, 3); // Dynamic scaling window padding

      // Handle narrow viewports/aspect ratios when parameter is highlighted
      if (aspect < 1) {
        zoomOffset = zoomOffset / aspect;
      }

      camPosDest.set(
        featureCenter.x + zoomOffset * 0.7,
        featureCenter.y + zoomOffset * 0.7,
        featureCenter.z + zoomOffset * 1.0
      );
    } else {
      // Fallback: Reset to centering the whole model geometry if no parameter is selected
      lookAtDest.set(0, 0, 0);
      
      if (geometryInfo && geometryInfo.size) {
        const size = geometryInfo.size;
        const maxDim = Math.max(size[0], size[1], size[2]);
        
        // Fit distance calculation
        const radius = maxDim / 2;
        const fovRad = (camera.fov * Math.PI) / 180;
        let dist = radius / Math.sin(fovRad / 2);
        
        // Adjust for narrow aspect ratio (e.g. portrait screen or side panels open)
        if (aspect < 1) {
          dist = dist / aspect;
        }
        
        // Dynamic camera distance with safety padding multiplier
        const fitDistance = Math.max(dist * 1.35, 10);
        
        camPosDest.set(
          fitDistance * 0.7,
          fitDistance * 0.7,
          fitDistance * 1.0
        );
      } else {
        camPosDest.set(5, 5, 5);
      }
    }

    targetLookAt.current.copy(lookAtDest);
    targetCamPos.current.copy(camPosDest);

    // Initialize starting state for 400ms transition
    startLookAt.current.copy(controls ? controls.target : new THREE.Vector3(0, 0, 0));
    startCamPos.current.copy(camera.position);
    startTime.current = performance.now();
    isTransitioning.current = true;
  }, [activeParameter, annotations, geometryInfo, controls, camera, aspect]);

  useFrame(() => {
    if (!isTransitioning.current) return;

    const now = performance.now();
    const elapsed = now - startTime.current;
    const duration = 400; // 400ms transition duration
    const progress = Math.min(elapsed / duration, 1.0);

    // Quadratic ease-out interpolation factor: t * (2 - t)
    const easeT = progress * (2 - progress);

    // Interpolate Camera position
    camera.position.lerpVectors(startCamPos.current, targetCamPos.current, easeT);

    // Interpolate OrbitControls pivot target smoothly
    if (controls) {
      controls.target.lerpVectors(startLookAt.current, targetLookAt.current, easeT);
      controls.update();
    }

    if (progress >= 1.0) {
      isTransitioning.current = false;
    }
  });

  return null;
}
