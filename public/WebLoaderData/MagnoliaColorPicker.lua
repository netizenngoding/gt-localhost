local screen=Client.GetScreen()
local W=math.min(460,screen.width-24)
local H=396
local OX=math.floor((screen.width-W)/2)
local OY=math.floor((screen.height-H)/2)
local TRACK=W-40
local ROWS={156,194,232,270}
local input=Input.GetTypes()
local open=false
local dragging=nil
local target="border"
local colors={}
local hsv={}

local function packed(r,g,b,a) return b*16777216+g*65536+r*256+a end
local function set(id,p) assert(Proton.Set(id,p),"Magnolia Color Picker: command queue full") end
local function clamp(v) return math.max(0,math.min(255,math.floor(v+.5))) end

local function parseColor(value,fallback)
    local r,g,b,a=tostring(value or ""):match("^(%d+),(%d+),(%d+),(%d+)$")
    if not r then return {r=fallback[1],g=fallback[2],b=fallback[3],a=fallback[4]} end
    return {r=clamp(tonumber(r)),g=clamp(tonumber(g)),b=clamp(tonumber(b)),a=clamp(tonumber(a))}
end

local function rgba(c) return string.format("%d,%d,%d,%d",c.r,c.g,c.b,c.a) end

local function toHsv(c)
    local r,g,b=c.r/255,c.g/255,c.b/255
    local hi,lo=math.max(r,g,b),math.min(r,g,b)
    local d=hi-lo
    local h=0
    if d>0 then
        if hi==r then h=((g-b)/d)%6
        elseif hi==g then h=(b-r)/d+2
        else h=(r-g)/d+4 end
        h=h*60
    end
    return {h=h,s=hi==0 and 0 or d/hi,v=hi,a=c.a}
end

local function fromHsv(h)
    local c=h.v*h.s
    local x=c*(1-math.abs((h.h/60)%2-1))
    local r,g,b=0,0,0
    if h.h<60 then r,g=c,x
    elseif h.h<120 then r,g=x,c
    elseif h.h<180 then g,b=c,x
    elseif h.h<240 then g,b=x,c
    elseif h.h<300 then r,b=x,c
    else r,b=c,x end
    local m=h.v-c
    return clamp((r+m)*255),clamp((g+m)*255),clamp((b+m)*255)
end

assert(Proton.Panel("mcp_root",{x=OX,y=OY,width=W,height=H,modal=true,visible=false,
    color=packed(12,29,43,250),borderColor=0xccb887ff}))
assert(Proton.Text("mcp_title",{parent="mcp_root",x=20,y=12,text="`wCUSTOM BORDER & THEME",fontScale=.82}))
assert(Proton.Button("mcp_close",{parent="mcp_root",x=W-52,y=10,width=32,height=32,text="X",fontScale=.6,
    color=0xccb887ff,borderColor=0xccb887ff}))
local targetWidth=(W-50)/2
assert(Proton.Button("mcp_border",{parent="mcp_root",x=20,y=52,width=targetWidth,height=34,text="Border Color",fontScale=.58,
    color=0xccb887ff,borderColor=0xccb887ff}))
assert(Proton.Button("mcp_background",{parent="mcp_root",x=30+targetWidth,y=52,width=targetWidth,height=34,text="Background Color",fontScale=.58,
    color=0xccb887ff,borderColor=0xccb887ff}))
assert(Proton.Panel("mcp_preview",{parent="mcp_root",x=20,y=96,width=76,height=48,color=0xffffffff,borderColor=0xccb887ff}))
assert(Proton.Text("mcp_preview_label",{parent="mcp_root",x=110,y=96,text="`wBorder Color",fontScale=.62}))
assert(Proton.Text("mcp_rgba",{parent="mcp_root",x=110,y=122,text="`o0, 0, 0, 255",fontScale=.52}))

local names={"Hue","Saturation","Brightness","Transparency"}
for i,name in ipairs(names) do
    assert(Proton.Text("mcp_label_"..i,{parent="mcp_root",x=20,y=ROWS[i],text="`w"..name,fontScale=.5}))
    assert(Proton.Text("mcp_value_"..i,{parent="mcp_root",x=W-110,y=ROWS[i],text="`o",fontScale=.5}))
    if i==1 then
        local sw=TRACK/12
        for seg=0,11 do
            local r,g,b=fromHsv({h=seg*30,s=1,v=1})
            assert(Proton.Panel("mcp_hue_"..seg,{parent="mcp_root",x=20+seg*sw,y=ROWS[i]+19,width=sw+1,height=12,
                color=packed(r,g,b,255),borderColor=packed(r,g,b,255)}))
        end
    else
        local shades={packed(92,112,128,255),packed(40,48,56,255),packed(230,230,230,255)}
        assert(Proton.Panel("mcp_track_"..i,{parent="mcp_root",x=20,y=ROWS[i]+19,width=TRACK,height=12,
            color=shades[i-1],borderColor=0xccb887ff}))
    end
    assert(Proton.Panel("mcp_knob_"..i,{parent="mcp_root",x=16,y=ROWS[i]+14,width=9,height=22,
        color=0xccb887ff,borderColor=packed(45,35,22,255)}))
end
local buttonWidth=(W-60)/2
assert(Proton.Button("mcp_back",{parent="mcp_root",x=20,y=H-46,width=buttonWidth,height=34,text="Back",fontScale=.6,
    color=0xccb887ff,borderColor=0xccb887ff}))
assert(Proton.Button("mcp_apply",{parent="mcp_root",x=40+buttonWidth,y=H-46,width=buttonWidth,height=34,text="Apply Changes",fontScale=.6,
    color=0xccb887ff,borderColor=0xccb887ff}))
set("mcp_root",{visible=false,recursive=true})

local function ratios(h) return {h.h/360,h.s,h.v,h.a/255} end
local function refresh()
    local c,h=colors[target],hsv[target]
    local r=ratios(h)
    set("mcp_preview",{color=packed(c.r,c.g,c.b,c.a)})
    set("mcp_preview_label",{text="`w"..(target=="border" and "Border Color" or "Background Color")})
    set("mcp_rgba",{text="`o"..rgba(c)})
    set("mcp_border",{color=target=="border" and 0xffffffff or 0xccb887ff})
    set("mcp_background",{color=target=="background" and 0xffffffff or 0xccb887ff})
    for i=1,4 do
        set("mcp_knob_"..i,{x=20+r[i]*(TRACK-9)})
        local value=i==1 and string.format("%d`o",math.floor(h.h+.5)) or string.format("%d%%",math.floor(r[i]*100+.5))
        set("mcp_value_"..i,{text="`o"..value})
    end
end

local function changeTarget(next)
    target=next
    dragging=nil
    refresh()
end

local function moveSlider(x)
    if not dragging then return end
    local ratio=math.max(0,math.min(1,(x-(OX+20))/(TRACK-9)))
    local h=hsv[target]
    if dragging==1 then h.h=ratio*360
    elseif dragging==2 then h.s=ratio
    elseif dragging==3 then h.v=ratio
    else h.a=clamp(ratio*255) end
    local r,g,b=fromHsv(h)
    colors[target].r,colors[target].g,colors[target].b=r,g,b
    colors[target].a=h.a
    refresh()
end

local function show(border,background)
    colors.border=parseColor(border,{204,184,135,255})
    colors.background=parseColor(background,{21,53,72,210})
    hsv.border=toHsv(colors.border)
    hsv.background=toHsv(colors.background)
    target="border"
    dragging=nil
    open=true
    refresh()
    set("mcp_root",{visible=true,recursive=true})
end

local function hide()
    open=false
    dragging=nil
    set("mcp_root",{visible=false,recursive=true})
end

AddHook("OnVariant","magnolia_color_picker",function(v)
    if v[0]=="OnMagnoliaColorPicker" then show(v[1],v[2]) end
    return false
end)

Script.On("OnInput","magnolia_color_picker",function(kind,x,y)
    if not open then return end
    if kind==input.PointerUp then dragging=nil return end
    if kind==input.PointerDown then
        for i=1,4 do
            if x>=OX+12 and x<=OX+W-12 and y>=OY+ROWS[i]+8 and y<=OY+ROWS[i]+38 then
                dragging=i
                moveSlider(x)
                return
            end
        end
    elseif (kind==input.PointerMove or kind==input.PointerDrag) and dragging then moveSlider(x) end
end)

Script.On("OnProtonEvent","magnolia_color_picker",function(id,event)
    if event~="click" then return end
    if id=="mcp_border" then changeTarget("border")
    elseif id=="mcp_background" then changeTarget("background")
    elseif id=="mcp_apply" then
        local border,bg=rgba(colors.border),rgba(colors.background)
        hide()
        SendVariant({[0]="OnMagnoliaColorApply",[1]=border,[2]=bg})
    elseif id=="mcp_back" or id=="mcp_close" then
        hide()
        SendVariant({[0]="OnMagnoliaColorCancel"})
    end
end)

Sleep(-1)
