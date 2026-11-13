"""Silkscreen Kimono: the phone's turntable, rendered from silkscreen-kimono.glb.

SPDX-License-Identifier: CERN-OHL-S-2.0
Part of the Silkscreen Kimono model, from iandchasse's Silkscreen enclosure (idc LLC, CERN-OHL-S v2): see NOTICE.txt.

The Compose app has no 3D renderer, so it scrubs a sprite sheet: FRAMES views a full turn round (frame k is the model
turned k * 360 / FRAMES degrees about its upright axis, its front moving right, as a drag to the right turns it on the
web), seen from a little above as the web viewer sees it, in COLUMNS columns, transparent around the case. Rendered
offscreen with VTK at twice the size and scaled down, then written as a lossy WebP.

Usage: python make_turntable.py <out.webp>
"""
import math
import sys
from pathlib import Path

import numpy as np
import vtk
from PIL import Image
from vtk.util.numpy_support import vtk_to_numpy

HERE = Path(__file__).resolve().parent
FRAMES, COLUMNS, W, H, SS = 36, 6, 216, 288, 2

importer = vtk.vtkGLTFImporter()
importer.SetFileName(str(HERE / 'silkscreen-kimono.glb'))
window = vtk.vtkRenderWindow()
window.SetOffScreenRendering(1)
window.SetAlphaBitPlanes(1)
window.SetSize(W * SS, H * SS)
renderer = vtk.vtkRenderer()
renderer.SetBackground(1, 1, 1)
renderer.SetBackgroundAlpha(0)
renderer.UseFXAAOn()
window.AddRenderer(renderer)
importer.SetRenderWindow(window)
importer.Update()

# glTF colours are sRGB, as three.js reads them; VTK takes them as they are, which washes them out, so they are
# made linear here (the page's texture is left alone)
actors = renderer.GetActors()
actors.InitTraversal()
for _ in range(actors.GetNumberOfItems()):
    prop = actors.GetNextActor().GetProperty()
    prop.SetColor(*[c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in prop.GetColor()])
renderer.RemoveAllLights()
for pos, colour, power in (((2.5, 3, 4), (1, 1, 1), 1.5), ((-3, 1.5, -4), (1, .95, .9), .6), ((-1, -2, 3), (1, .98, .95), .6)):
    light = vtk.vtkLight()
    light.SetLightTypeToCameraLight()
    light.SetPosition(*pos)
    light.SetFocalPoint(0, 0, 0)
    light.SetColor(*colour)
    light.SetIntensity(power)
    renderer.AddLight(light)
renderer.SetAmbient(.25, .25, .25)

bounds = [0.0] * 6
renderer.ComputeVisiblePropBounds(bounds)
centre = np.array([(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2])
tall = bounds[3] - bounds[2]
camera = renderer.GetActiveCamera()
camera.SetViewAngle(26)
distance = max(tall, (bounds[1] - bounds[0]) * 1.3) / 2 / math.tan(math.radians(13)) * 1.12
tilt = math.radians(8)


def shot():
    grab = vtk.vtkWindowToImageFilter()
    grab.SetInput(window)
    grab.SetInputBufferTypeToRGBA()
    grab.ReadFrontBufferOff()
    grab.Update()
    img = grab.GetOutput()
    w, h, _ = img.GetDimensions()
    a = vtk_to_numpy(img.GetPointData().GetScalars()).reshape(h, w, 4)[::-1]
    return Image.fromarray(np.ascontiguousarray(a), 'RGBA').resize((W, H), Image.LANCZOS)


rows = math.ceil(FRAMES / COLUMNS)
sheet = Image.new('RGBA', (W * COLUMNS, H * rows), (0, 0, 0, 0))
for k in range(FRAMES):
    a = math.radians(k * 360 / FRAMES)         # the model turned by a: the camera goes the other way round it
    eye = centre + distance * np.array([-math.sin(a) * math.cos(tilt), math.sin(tilt), math.cos(a) * math.cos(tilt)])
    camera.SetFocalPoint(*centre)
    camera.SetPosition(*eye)
    camera.SetViewUp(0, 1, 0)
    renderer.ResetCameraClippingRange()
    window.Render()
    sheet.paste(shot(), (k % COLUMNS * W, k // COLUMNS * H))
out = Path(sys.argv[1])
sheet.save(out, 'WEBP', quality=82, method=6)
print(out, out.stat().st_size // 1024, 'KB')
