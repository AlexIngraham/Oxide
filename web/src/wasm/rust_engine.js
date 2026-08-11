/* @ts-self-types="./rust_engine.d.ts" */

/**
 * Adds `amount` to every color channel, clamped to the byte range.
 *
 * `amount` is expressed in channel values and must be in `-255..=255`.
 * @param {Uint8Array} pixels
 * @param {number} amount
 */
export function adjust_brightness(pixels, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_brightness(retptr, ptr0, len0, addHeapObject(pixels), amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Adjusts broad local contrast in the midtones.
 *
 * Unlike global contrast, clarity compares each channel with a 9x9 local
 * mean. Unlike texture, it uses a broader neighborhood and a smooth midtone
 * mask, protecting deep shadows and bright highlights. `amount` must be in
 * `-100..=100`, with zero as the neutral/default value; edge samples are
 * clamped and alpha is preserved.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} amount
 */
export function adjust_clarity(pixels, width, height, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_clarity(retptr, ptr0, len0, addHeapObject(pixels), width, height, amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Adjusts contrast around the midpoint of 128.
 *
 * `amount` is a finite adjustment value in `-100..=100`. The transform uses
 * the common contrast factor
 * `(259 * (amount + 255)) / (255 * (259 - amount))`.
 * @param {Uint8Array} pixels
 * @param {number} amount
 */
export function adjust_contrast(pixels, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_contrast(retptr, ptr0, len0, addHeapObject(pixels), amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Adjusts bright tones while leaving shadows and low midtones unchanged.
 *
 * `amount` must be in `-100..=100`, with zero as the neutral/default value.
 * A smooth luminance mask begins at 50% gray and reaches full strength at
 * white, avoiding a hard tonal boundary.
 * @param {Uint8Array} pixels
 * @param {number} amount
 */
export function adjust_highlights(pixels, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_highlights(retptr, ptr0, len0, addHeapObject(pixels), amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Adjusts color saturation relative to perceptual luminance.
 *
 * `amount` must be in `-100..=100`: `-100` is grayscale, `0` is unchanged,
 * and `100` doubles each channel's distance from luminance.
 * @param {Uint8Array} pixels
 * @param {number} amount
 */
export function adjust_saturation(pixels, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_saturation(retptr, ptr0, len0, addHeapObject(pixels), amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Boosts or suppresses fine RGB detail relative to a 3x3 local mean.
 *
 * `amount` must be in `-100..=100`, with zero as the neutral/default value.
 * Positive values amplify the fine-scale high-pass signal; at `-100`, the
 * output is the local mean. Edge samples are clamped to the nearest pixel and
 * alpha is preserved.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} amount
 */
export function adjust_texture(pixels, width, height, amount) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.adjust_texture(retptr, ptr0, len0, addHeapObject(pixels), width, height, amount);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Applies an optimized separable Gaussian blur to the RGB channels.
 *
 * The kernel has `2 * radius + 1` taps and sigma `max(radius / 2, 0.5)`.
 * Edge samples are clamped to the nearest pixel. Radius zero is a validated
 * no-op, and the maximum supported radius is 64.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
export function gaussian_blur(pixels, width, height, radius) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.gaussian_blur(retptr, ptr0, len0, addHeapObject(pixels), width, height, radius);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Converts an RGBA buffer to perceptual grayscale.
 *
 * Uses Rec. 601 luma (`0.299R + 0.587G + 0.114B`) and preserves alpha.
 * @param {Uint8Array} pixels
 */
export function grayscale(pixels) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.grayscale(retptr, ptr0, len0, addHeapObject(pixels));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Runs Sobel edge detection and writes a grayscale edge magnitude.
 *
 * Magnitudes below `threshold` are set to black; remaining magnitudes are
 * clamped to 255. Sampling at image boundaries is clamped to the nearest
 * pixel. Alpha is copied through unchanged.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} threshold
 */
export function sobel_edges(pixels, width, height, threshold) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = passArray8ToWasm0(pixels, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        wasm.sobel_edges(retptr, ptr0, len0, addHeapObject(pixels), width, height, threshold);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_c7f28e53671b41e8: function(arg0, arg1, arg2) {
            new Uint8Array(getObject(arg2).buffer, getObject(arg2).byteOffset, getObject(arg2).byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./rust_engine_bg.js": import0,
    };
}

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rust_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
