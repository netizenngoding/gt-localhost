import fs from "node:fs";
import { URL } from "node:url";
import path from "node:path";
export interface MenuButtonConfig { text:string;url:string;color:string;textColor:string;iconPath:string;iconEnabled:boolean; }
export interface ServerBrandingConfig { menuButton:MenuButtonConfig; autofillLabel:string; autofillAccent:string; serverName:string;version:string;logoPath:string;skipIntro:boolean;enableDeveloperMenu:boolean;minecraftHealthBar:boolean;growtopiaLoadingScreen:boolean;hideLegacyCustomItemWarning:boolean;splashes:string[];discordUrl:string; }
export function validateBranding(raw: unknown): ServerBrandingConfig {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("Invalid server config");
  const v=raw as Record<string,unknown>;
  const input=v.menuButton;
  if(input!==undefined && (!input || typeof input!=="object" || Array.isArray(input))) throw new Error("menuButton must be an object");
  const b={text:"@salakpatty",url:"https://www.tiktok.com/@salakpatty",color:"#A5E3FB",textColor:"#FFFFFF",iconPath:"branding/tiktok.svg",iconEnabled:true,...(input as Record<string,unknown>||{})};
  if(typeof b.text!=="string" || !b.text.trim() || b.text.length>24 || /[`|<>\r\n\x00-\x1f]/.test(b.text)) throw new Error("menuButton.text: 1–24 plain characters");
  if(typeof b.url!=="string" || !/^https:\/\//.test(b.url)) throw new Error("menuButton.url must use HTTPS");
  try {const u=new URL(b.url);if(u.username||u.password)throw 0;} catch {throw new Error("Invalid menuButton.url");}
  for(const color of [b.color,b.textColor]) if(typeof color!=="string" || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Menu colors must use #RRGGBB");
  if(typeof b.iconPath!=="string" || !/^[A-Za-z0-9_/-]+\.(png|svg)$/.test(b.iconPath) || b.iconPath.startsWith("/") || b.iconPath.includes("..")) throw new Error("Invalid local menuButton.iconPath");
  if(typeof b.iconEnabled!=="boolean") throw new Error("menuButton.iconEnabled must be boolean");
  const menuButton=b as MenuButtonConfig;
  const name=v.serverName;
  const version=v.version ?? "V1.5";
  if(typeof version!=="string" || !version.trim() || version.length>32 || /[`|<>\r\n\x00-\x1f]/.test(version)) throw new Error("version: use 1–32 plain-text characters");
  if(typeof name!=="string" || !name.trim() || name.length>40 || !/^[\x20-\x7e]+$/.test(name) || /[`|<>]/.test(name)) throw new Error("serverName: use 1–40 ASCII characters, no packet/markup delimiters");
  if(typeof v.logoPath!=="string" || !/^[A-Za-z0-9_/-]+\.png$/.test(v.logoPath) || v.logoPath.startsWith("/") || v.logoPath.includes("..")) throw new Error("logoPath must be a local PNG relative to public/");
  if(typeof v.skipIntro!=="boolean" || typeof v.hideLegacyCustomItemWarning!=="boolean") throw new Error("Client options must be booleans");
  const enableDeveloperMenu = v.enableDeveloperMenu ?? false;
  const minecraftHealthBar = v.minecraftHealthBar ?? true;
  const growtopiaLoadingScreen = v.growtopiaLoadingScreen ?? true;
  if(typeof enableDeveloperMenu!=="boolean" || typeof minecraftHealthBar!=="boolean" || typeof growtopiaLoadingScreen!=="boolean") throw new Error("Feature toggle options must be booleans");
  if(!Array.isArray(v.splashes) || v.splashes.length>30 || v.splashes.some(x=>typeof x!=="string" || x.length>140 || /[\r\n|\x00-\x1f]/.test(x))) throw new Error("Invalid splashes");
  const autofillLabel = v.autofillLabel ?? "Autofill";
  if(typeof autofillLabel!=="string" || !/^[\x20-\x7e]{1,70}$/.test(autofillLabel) || /[`|<>]/.test(autofillLabel)) throw new Error("autofillLabel: 1–70 plain ASCII characters");
  const autofillAccent = v.autofillAccent ?? "#E3B5FF";
  if(typeof autofillAccent!=="string" || !/^#[0-9a-f]{6}$/i.test(autofillAccent)) throw new Error("autofillAccent must use #RRGGBB");
  const discordUrl=v.discordUrl ?? "https://discord.com/";
  if(typeof discordUrl!=="string" || !/^https:\/\//.test(discordUrl) || /[|\r\n]/.test(discordUrl))throw new Error("discordUrl must use HTTPS");
  try {const u=new URL(discordUrl);if(u.username||u.password)throw 0;}catch{throw new Error("Invalid discordUrl");}
  return {discordUrl,menuButton,autofillLabel,autofillAccent,serverName:name.trim(),version:version.trim(),logoPath:v.logoPath,skipIntro:v.skipIntro,enableDeveloperMenu,minecraftHealthBar,growtopiaLoadingScreen,hideLegacyCustomItemWarning:v.hideLegacyCustomItemWarning,splashes:v.splashes as string[]};
}
export function loadBranding(root=process.cwd()):ServerBrandingConfig {
 const file=path.join(root,"config/server.json");
 return validateBranding(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{serverName:"Game Server",logoPath:"branding/logo.png",skipIntro:true,hideLegacyCustomItemWarning:true,splashes:["Welcome to {serverName}!"]});
}
export const SERVER_CONFIG=loadBranding();
export const SERVER_NAME=SERVER_CONFIG.serverName;
