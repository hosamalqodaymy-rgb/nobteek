"""Outline Arabic/Latin text with the shipped font and system HarfBuzz.

All exported SVGs contain paths, not remote fonts or external raster images.
"""
import ctypes as C
import ctypes.util
import html
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

LIBRARY=ctypes.util.find_library('harfbuzz')
if not LIBRARY:raise RuntimeError('libharfbuzz is required for SVG generation')
hb=C.CDLL(LIBRARY)
FRIBIDI=ctypes.util.find_library('fribidi')
if not FRIBIDI:raise RuntimeError('libfribidi is required for mixed Arabic/Latin SVG text')
fb=C.CDLL(FRIBIDI)
fb.fribidi_get_bidi_type.restype=C.c_uint32;fb.fribidi_get_bidi_type.argtypes=[C.c_uint32]
fb.fribidi_log2vis.restype=C.c_int8
fb.fribidi_log2vis.argtypes=[C.POINTER(C.c_uint32),C.c_int,C.POINTER(C.c_uint32),C.POINTER(C.c_uint32),C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_int8)]


class Info(C.Structure):
    _fields_=[('codepoint',C.c_uint32),('mask',C.c_uint32),('cluster',C.c_uint32),('var1',C.c_uint32),('var2',C.c_uint32)]


class Position(C.Structure):
    _fields_=[('x_advance',C.c_int32),('y_advance',C.c_int32),('x_offset',C.c_int32),('y_offset',C.c_int32),('var',C.c_uint32)]


def api(name,restype,argtypes):
    f=getattr(hb,name);f.restype=restype;f.argtypes=argtypes;return f


blob_create=api('hb_blob_create',C.c_void_p,[C.c_char_p,C.c_uint,C.c_int,C.c_void_p,C.c_void_p])
face_create=api('hb_face_create',C.c_void_p,[C.c_void_p,C.c_uint])
font_create=api('hb_font_create',C.c_void_p,[C.c_void_p])
ot_funcs=api('hb_ot_font_set_funcs',None,[C.c_void_p])
font_scale=api('hb_font_set_scale',None,[C.c_void_p,C.c_int,C.c_int])
buffer_create=api('hb_buffer_create',C.c_void_p,[])
add_utf8=api('hb_buffer_add_utf8',None,[C.c_void_p,C.c_char_p,C.c_int,C.c_uint,C.c_int])
guess=api('hb_buffer_guess_segment_properties',None,[C.c_void_p])
set_direction=api('hb_buffer_set_direction',None,[C.c_void_p,C.c_int])
direction_from_string=api('hb_direction_from_string',C.c_int,[C.c_char_p,C.c_int])
shape=api('hb_shape',None,[C.c_void_p,C.c_void_p,C.c_void_p,C.c_uint])
infos=api('hb_buffer_get_glyph_infos',C.POINTER(Info),[C.c_void_p,C.POINTER(C.c_uint)])
positions=api('hb_buffer_get_glyph_positions',C.POINTER(Position),[C.c_void_p,C.POINTER(C.c_uint)])
buffer_destroy=api('hb_buffer_destroy',None,[C.c_void_p])


class Outliner:
    def __init__(self,font_path):
        self.data=Path(font_path).read_bytes()
        self.tt=TTFont(font_path);self.glyphs=self.tt.getGlyphSet();self.names=self.tt.getGlyphOrder()
        self.upem=self.tt['head'].unitsPerEm
        self.blob=blob_create(self.data,len(self.data),0,None,None)
        self.face=face_create(self.blob,0);self.font=font_create(self.face);ot_funcs(self.font)
        font_scale(self.font,self.upem,self.upem)

    def _shape_run(self,text,rtl):
        b=buffer_create();data=text.encode('utf-8');add_utf8(b,data,len(data),0,len(data));guess(b)
        # The Unicode bidi algorithm chooses run order; HarfBuzz shapes each logical run.
        set_direction(b,direction_from_string(b'rtl' if rtl else b'ltr',-1));shape(self.font,b,None,0)
        count=C.c_uint();ii=infos(b,C.byref(count));pp=positions(b,C.byref(count))
        result=[];cursor=0
        for index in range(count.value):
            result.append((self.names[ii[index].codepoint],cursor+pp[index].x_offset,pp[index].y_offset))
            cursor+=pp[index].x_advance
        buffer_destroy(b)
        return result,cursor

    def layout(self,text):
        if not text:return [],0
        count=len(text);logical=(C.c_uint32*count)(*[ord(ch) for ch in text]);visual=(C.c_uint32*count)()
        ltv=(C.c_int*count)();vtl=(C.c_int*count)();levels=(C.c_int8*count)()
        base=C.c_uint32(fb.fribidi_get_bidi_type(ord('!')))
        if not fb.fribidi_log2vis(logical,count,C.byref(base),visual,ltv,vtl,levels):raise RuntimeError('Bidi resolution failed')
        runs=[];start=0
        for index in range(1,count+1):
            if index==count or levels[index]!=levels[start]:
                runs.append((min(ltv[start:index]),text[start:index],levels[start]%2==1));start=index
        result=[];cursor=0
        for _,content,rtl in sorted(runs):
            glyphs,advance=self._shape_run(content,rtl)
            result.extend((name,x+cursor,y) for name,x,y in glyphs);cursor+=advance
        return result,cursor

    def draw(self,text,x,y,size,color,anchor='left'):
        shaped,width=self.layout(text);scale=size/self.upem
        x=x-width*scale if anchor=='right' else x-width*scale/2 if anchor=='middle' else x
        paths=[]
        for name,dx,dy in shaped:
            pen=SVGPathPen(self.glyphs);self.glyphs[name].draw(pen);path=pen.getCommands()
            if path:
                paths.append(f'<path d="{path}" transform="translate({x+dx*scale:.4f} {y-dy*scale:.4f}) scale({scale:.6f} {-scale:.6f})"/>')
        return '<g fill="'+color+'" aria-label="'+html.escape(text,quote=True)+'">'+''.join(paths)+'</g>'


def icon(color='currentColor',x=0,y=0,size=24):
    s=size/24
    return f'''<g transform="translate({x} {y}) scale({s})" fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<path d="M6 3h12a3 3 0 0 1 3 3v3a3 3 0 0 0 0 6v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3a3 3 0 0 0 0-6V6a3 3 0 0 1 3-3Z"/>
<path d="M7 7.5h10M7 11.5h6M7 15.5h3"/><circle cx="15.8" cy="15.5" r="1.5" fill="{color}" stroke="none"/></g>'''


def svg(width,height,content,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img"><title>{html.escape(title)}</title>{content}</svg>'
