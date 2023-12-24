import {
  BasicExampleFactory,
  HelperExampleFactory,
  KeyExampleFactory,
  PromptExampleFactory,
  UIExampleFactory,
} from "./modules/examples";
import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";


async function importPdfToZotero(filePath: string, parentItemId: number): Promise<Zotero.Item> {
  
    // Define the options for importing the file
    const options = {
        file: filePath,           // Path to the PDF file
        parentItemID: parentItemId // ID of the parent item
    };

    // Import the file into Zotero
    try {
        const importedItem = await Zotero.Attachments.importFromFile(options);
        console.log('PDF imported successfully:', importedItem);
        return importedItem;
    } catch (error) {
        console.error('Error importing PDF to Zotero:', error);
        throw error;
    }
}

function checkForDigiVatLib(input: string): { processed: boolean; result: string } {
  if (input.includes(" | DigiVatLib")) {
    // If the " | DigiVatLib" part exists, insert a whitespace after each "."
    const processedString = input.replace(/\./g, '. ');
    // If " | DigiVatLib" exists, remove it
    const indexOfDigiVatLib = input.indexOf(" | DigiVatLib");
    if (indexOfDigiVatLib !== -1) {
      input = input.substring(0, indexOfDigiVatLib);
    }

    return { processed: true, result: processedString };
  } else {
    // If " | DigiVatLib" does not exist, return the original string
    return { processed: false, result: input };
  }
}


async function onAdd(id: number) {
  const item = Zotero.Items.get(id)
  const itemName = item.getDisplayTitle()
  ztoolkit.log("added item " + itemName)

  const { processed: isDigiVatLib, result: newName } = checkForDigiVatLib(itemName);

  if(isDigiVatLib){
    ztoolkit.log("item is digi vat lib item")
    item.setType(24); // 24 = manuscript
    item.setField("title", newName)
    item.saveTx()
    const url = item.getField("url") as string
    const manifestURL = await fetchIIIFManifestURL(url) as string
    ztoolkit.log("manifest url: " + manifestURL)
    const manifest = await fetchManifest(manifestURL)
    ztoolkit.log("fetched manifest:")
    ztoolkit.log(manifest)
    const imageLinks = extractImageUrls(manifest) as Array<string>
    ztoolkit.log("image link example: " + imageLinks[0])
    const pdfnsIFile = (await Zotero.Attachments.createTemporaryStorageDirectory())
    pdfnsIFile.append("manuscript.pdf")
    ztoolkit.log("pdf file path: " + pdfnsIFile.path)
    await downloadImagesAsPDF(imageLinks, pdfnsIFile, newName)
    const attachment = await importPdfToZotero(pdfnsIFile.path, item.id)
    attachment.saveTx()
    item.saveTx()
    ztoolkit.log(item)
  }

}



async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // TODO: Remove this after zotero#3387 is merged
  if (__env__ === "development") {
    // Keep in sync with the scripts/startup.mjs
    const loadDevToolWhen = `Plugin ${config.addonID} startup`;
    ztoolkit.log(loadDevToolWhen);
  }

  initLocale();

  BasicExampleFactory.registerPrefs();

  BasicExampleFactory.registerNotifier();

  KeyExampleFactory.registerShortcuts();

  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {

  if(event == "add"){
    onAdd(ids[0] as number);
  }
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  if (
    event == "select" &&
    type == "tab" &&
    extraData[ids[0]].type == "reader"
  ) {
    BasicExampleFactory.exampleNotifierCallback();
  } else {
    return;
  }
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    case "larger":
      KeyExampleFactory.exampleShortcutLargerCallback();
      break;
    case "smaller":
      KeyExampleFactory.exampleShortcutSmallerCallback();
      break;
    default:
      break;
  }
}

function onDialogEvents(type: string) {
  switch (type) {
    case "dialogExample":
      HelperExampleFactory.dialogExample();
      break;
    case "clipboardExample":
      HelperExampleFactory.clipboardExample();
      break;
    case "filePickerExample":
      HelperExampleFactory.filePickerExample();
      break;
    case "progressWindowExample":
      HelperExampleFactory.progressWindowExample();
      break;
    case "vtableExample":
      HelperExampleFactory.vtableExample();
      break;
    default:
      break;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onAdd,
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};

import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs'
import ZoteroToolkit from "zotero-plugin-toolkit";

async function fetch(url: string): Promise<string>{
    const request = await Zotero.HTTP.request('GET', url);
    if (request.status !== 200) {
        ztoolkit.log('Failed to fetch data from the link');
    }
    ztoolkit.log("response from \"" + url + "\": " + (request.response))
    return request.response
}

async function fetchIIIFManifestURL(itemUrl: string): Promise<string> {
  ztoolkit.log("fetching IIIF manuscript url")
    const htmlSource = await fetch(itemUrl)
    ztoolkit.log("fetched webpage:")
    ztoolkit.log(htmlSource)
    const match = htmlSource.match(/"iiif_manifest_url":\s*"([^"]+)"/);
    ztoolkit.log("match found")
    return match ? match[1] : "null";
}

async function fetchManifest(url: string): Promise<any> {
    const manifest = await fetch(url);
    const object = JSON.parse(manifest)
    ztoolkit.log("retrieved manifest object: " + object) 
    return object
}
function extractImageUrls(manifest: any) : Array<string>{
    return manifest.sequences[0].canvases.map((canvas: any) => {
        const service = canvas.images[0].resource.service;
        if (service) {
            // Construct the URL for the full resolution image
            return service['@id'] + '/full/full/0/default.jpg';
        }
        return null; // or handle this case as needed
    }).filter((url:string) => url !== null); // Filter out any null URLs
}

function stringToArrayBuffer(str: string): Uint8Array {
    // Create a byte array
    const byteArray = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        // Convert each character to its byte value
        byteArray[i] = str.charCodeAt(i);
    }
    ztoolkit.log(byteArray)
    return byteArray;
}

async function addImageToPDF(url: string, pdfDoc: PDFDocument) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob'; // Fetch the image as a blob

    xhr.onload = async () => {
      if (xhr.status === 200) {
        const blob = xhr.response;
        const arrayBuffer = await blob.arrayBuffer(); // Convert blob to arrayBuffer
        const image = await pdfDoc.embedJpg(arrayBuffer); // Embed image in the PDF
        const page = pdfDoc.addPage();
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
        });
        resolve(pdfDoc);
      } else {
        reject('Image load failed');
      }
    };

    xhr.onerror = () => {
      reject('Network error');
    };

    xhr.send();
  });
}





async function downloadImagesAsPDF(urls: Array<string>, pdfTargetDirectory: nsIFile, manuscriptName: string){
  const popup = new ztoolkit.ProgressWindow(manuscriptName, {
    closeOnClick: true,
    closeTime: -1,
  }).createLine({
      text: "Starting to download…",
      type: "default",
      progress: 0,
    })
    .show();


  const pdfDoc = await PDFDocument.create();
  let counter = 0
  for (const url of urls) {
    try {
      ztoolkit.log("now downloading no. " + counter +": " + url)
       popup.changeLine({
        text: "Now downloading image no. " + counter + " out of " + urls.length + "…",
        type: "default",
        progress: (counter / urls.length) * 90
      })
      await addImageToPDF(url, pdfDoc)
      ztoolkit.log("added image no. " + counter)
      counter += 1
    } catch (error) {
      ztoolkit.log((error as Error).message)
      break
    }
  }
  popup.changeLine({
        text: "Finished downloading images, now creating pdf. This may take a while…",
        type: "default",
        progress: 90
      })
  const pdfB64 = await pdfDoc.saveAsBase64()
  popup.changeLine({
        text: "Finished creating pdf, now saving…",
        type: "default",
        progress: 95
      })
  ztoolkit.log("pdf base64!")
  try {

  await Zotero.File.putContentsAsync(pdfTargetDirectory, b64toBlob(pdfB64, 'application/pdf'))
  popup.changeLine({
        text: "Finished!",
        type: "default",
        progress: 100
      })
  popup.startCloseTimer(5000)
  ztoolkit.log("saved file at: " + pdfTargetDirectory.path)
  } catch (error) {
    ztoolkit.log((error as Error).message)
  }
}


const b64toBlob = (b64Data: string, contentType='', sliceSize=512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);

    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
    
  const blob = new Blob(byteArrays, {type: contentType});
  return blob;
}


