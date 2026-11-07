"""Render the limited path/rect/circle SVG vocabulary emitted by the design builder."""
import re
import xml.etree.ElementTree as ET
from reportlab.lib.colors import HexColor
from fontTools.pens.basePen import BasePen
from fontTools.svgLib.path import parse_path


class CanvasPen(BasePen):
    def __init__(self,path):super().__init__(None);self.path=path
    def _moveTo(self,p):self.path.moveTo(*p)
    def _lineTo(self,p):self.path.lineTo(*p)
    def _curveToOne(self,p1,p2,p3):self.path.curveTo(*p1,*p2,*p3)
    def _closePath(self):self.path.close()
    def _endPath(self):pass


def draw_svg(canvas,source,x,y,width,height):
    root=ET.fromstring(source)
    vb=[float(v) for v in root.attrib['viewBox'].split()]
    factor=min(width/vb[2],height/vb[3])
    canvas.saveState();canvas.translate(x+(width-vb[2]*factor)/2,y+(height-vb[3]*factor)/2+vb[3]*factor);canvas.scale(factor,-factor)
    def render(element,inherited):
        tag=element.tag.rsplit('}',1)[-1]
        if tag=='title':return
        if tag not in ('svg','g','path','rect','circle'):raise ValueError('Unsupported vector element '+tag)
        canvas.saveState()
        style={**inherited,**{k:v for k,v in element.attrib.items() if k in ('fill','stroke','stroke-width','stroke-linecap','stroke-linejoin')}}
        for name,values in re.findall(r'(matrix|translate|scale)\(([^)]*)\)',element.attrib.get('transform','')):
            values=[float(v) for v in re.split(r'[,\s]+',values.strip()) if v]
            if name=='matrix':canvas.transform(*values)
            elif name=='translate':canvas.translate(values[0],values[1] if len(values)>1 else 0)
            else:canvas.scale(values[0],values[1] if len(values)>1 else values[0])
        fill=style.get('fill','#000000')!='none';stroke=style.get('stroke','none')!='none'
        if fill:canvas.setFillColor(HexColor(style.get('fill','#000000')))
        if stroke:canvas.setStrokeColor(HexColor(style['stroke']))
        canvas.setLineWidth(float(style.get('stroke-width',1)))
        canvas.setLineCap({'butt':0,'round':1,'square':2}.get(style.get('stroke-linecap','butt'),0))
        canvas.setLineJoin({'miter':0,'round':1,'bevel':2}.get(style.get('stroke-linejoin','miter'),0))
        if tag=='path':
            pen=CanvasPen(canvas.beginPath());parse_path(element.attrib['d'],pen);canvas.drawPath(pen.path,stroke=int(stroke),fill=int(fill),fillMode=1)
        elif tag=='rect':
            a=element.attrib;canvas.roundRect(float(a.get('x',0)),float(a.get('y',0)),float(a['width']),float(a['height']),float(a.get('rx',0)),stroke=int(stroke),fill=int(fill))
        elif tag=='circle':
            a=element.attrib;canvas.circle(float(a['cx']),float(a['cy']),float(a['r']),stroke=int(stroke),fill=int(fill))
        else:
            for child in element:render(child,style)
        canvas.restoreState()
    render(root,{})
    canvas.restoreState()
