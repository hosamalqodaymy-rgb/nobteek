const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'../design/assets');
async function main(){
 const names=['logo-ar','logo-ar-inverse','logo-mono','logo-en','icon-192','icon-512','icon-1024','cover-desktop','cover-mobile','identity-board','symbol-small-proof'];
 for(const name of names) await sharp(path.join(root,name+'.svg')).png().toFile(path.join(root,name+'.png'));
 for(const size of [24,48])await sharp(path.join(root,'symbol-primary.svg')).resize(size,size).png().toFile(path.join(root,`symbol-${size}.png`));
 console.log(JSON.stringify({png_assets:names.length+2}));
}
main().catch(e=>{console.error(e.message);process.exit(1)});
