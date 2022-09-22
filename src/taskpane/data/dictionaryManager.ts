import {useEffect, useState} from "react";
import axios from "axios";
import FuzzySet from 'fuzzyset'
import {WrongWordSuggestion} from "../ui/SingleWrongWord";
import {unique} from "../utils/stringUtils";
import * as config from "../../config"
import {useRemoteDictionary} from "../../config"
import * as bundledDictionary from "./bundledDictionary";
import {
    APIDictionary,
    APIWord,
    Dictionary,
    OptionalDictionary,
    PersistedDictionary
} from "./definitions";

export interface DictionaryManager {
    weHaveADictionary(): boolean;
    dictionary: OptionalDictionary;
    dictionaryUpdating: boolean;
    checkSpellings(toCheck: string[]): Promise<string[]>;
    retryDictionaryDownload();
    suggestCorrections(word: string): WrongWordSuggestion;
    addWordLocal(word: string);
    addWordGlobal(word: string);
    clearLocalDictionary();
}

const minSimilarityScore = .7;

export function useDictionaryManager(): DictionaryManager {
    const [dictionary, setDictionary] = useState<OptionalDictionary>(loadDictionary());
    const [ongoingAPICall, setOngoingAPICall] = useState<boolean>(false);

    function checkSpellings(toCheck: string[]): Promise<string[]> {
        return Promise.resolve(
            toCheck.filter(word => !dictionary.indexedWords[word])
        );
    }

    function suggestCorrections(word: string): WrongWordSuggestion {
        const result: [number, string] = dictionary.spellChecker.get(word, [], minSimilarityScore);
        return {
            wrong: word,
            suggestions: result.map(result => result[1]),
        };
    }

    function addWordLocal(word: string) {
        const persistedDictionary: PersistedDictionary = {
            id: dictionary.id,
            words: dictionary.words,
            language: dictionary.language,
            localWords: unique([...dictionary.localWords, word]),
            globalSuggestions: dictionary.globalSuggestions,
        };

        setDictionary(saveDictionary(persistedDictionary));
    }

    function addWordGlobal(word: string) {
        const persistedDictionary: PersistedDictionary = {
            id: dictionary.id,
            words: dictionary.words,
            language: dictionary.language,
            localWords: dictionary.localWords,
            globalSuggestions: [...dictionary.globalSuggestions, {word, synced: false}],
        };

        setDictionary(saveDictionary(persistedDictionary));
    }

    function noteDownSyncedSuggestions(words: string[]) {
        const persistedDictionary: PersistedDictionary = {
            id: dictionary.id,
            words: dictionary.words,
            language: dictionary.language,
            localWords: dictionary.localWords,
            globalSuggestions: dictionary.globalSuggestions.map(({word, synced}) => ({word, synced: synced || words.includes(word)})),
        };

        setDictionary(saveDictionary(persistedDictionary));
    }

    function clearLocalDictionary() {
        const persistedDictionary: PersistedDictionary = {
            id: dictionary.id,
            words: dictionary.words,
            language: dictionary.language,
            localWords: [],
            globalSuggestions: dictionary.globalSuggestions,
        };

        setDictionary(saveDictionary(persistedDictionary));
    }

    function mutexFetchDictionary() {
        if (ongoingAPICall) return;
        setOngoingAPICall(true);

        const fetchDictionary = useRemoteDictionary ? api.fetchDictionary : api.fetchBundledDictionary;

        fetchDictionary(config.language)
            .then((apiDictionary: APIDictionary) => {
                const persistedDictionary: PersistedDictionary = (
                    dictionary ?
                        {...dictionary, ...apiDictionary} :
                        {localWords: [], globalSuggestions: [], ...apiDictionary}
                );
                setDictionary(saveDictionary(persistedDictionary));
            })
            .finally(() => setOngoingAPICall(false));
    }

    useEffect(() => {
        setOngoingAPICall(true);
        api.checkWeHaveTheLatestVersion(dictionary)
            .then(weDo => {
                if (!weDo) mutexFetchDictionary();
            })
            .finally(() => setOngoingAPICall(false));
    }, []);

    useEffect(() => {
        if (!dictionary) return;
        api.suggestWords(config.language, dictionary.globalSuggestions.filter(suggestion => !suggestion.synced).map(suggestion => suggestion.word))
            .then((words: APIWord[]) => noteDownSyncedSuggestions(words.map(word => word.word)));
    }, []);

    return {
        weHaveADictionary: () => !!dictionary,
        dictionary,
        dictionaryUpdating: ongoingAPICall,
        checkSpellings,
        retryDictionaryDownload: mutexFetchDictionary,
        suggestCorrections,
        addWordLocal,
        addWordGlobal,
        clearLocalDictionary,
    };
}

const axiosInstance = axios.create({
    baseURL: config.apiURL,
    timeout: 30000,
});
const api = {
    fetchDictionary(languageName: string): Promise<APIDictionary> {
        return axiosInstance.get(`/languages/${languageName}/dictionaries/versions/latest`).then(result => result.data.data).catch(console.error);
    },
    fetchBundledDictionary(languageName: string): Promise<APIDictionary> {
        if (languageName !== bundledDictionary.language) throw Error(`Requested language(${languageName}) not available.`)
        return new Promise(() => bundledDictionary);
    },
    suggestWords(languageName: string, words: string[]): Promise<APIWord[]> {
        return axiosInstance.post(`/languages/${languageName}/suggestions`, {words}).then(result => result.data.data).catch(console.error);
    },
    checkWeHaveTheLatestVersion(dictionary: OptionalDictionary): Promise<boolean> {
        if (!dictionary) return Promise.resolve(false);
        if (!useRemoteDictionary) return Promise.resolve(dictionary.id === bundledDictionary.id);
        return axiosInstance.get(`/dictionaries/versions/${dictionary.id}/is_latest`).then(result => result.data.data.is_latest).catch(console.error);
    },
};

function loadDictionary(): OptionalDictionary {
    const savedDictionary = localStorage.getItem(config.dictionaryStorageKey);

    if (savedDictionary === null) return null;
    else {
        const dictionary: PersistedDictionary = JSON.parse(savedDictionary);
        const words = unique([...dictionary.words, ...dictionary.localWords, ...dictionary.globalSuggestions.map(globalSuggestion => globalSuggestion.word)]);

        const indexedWords = {};
        words.forEach(word => indexedWords[word] = true);

        return {
            ...dictionary,
            indexedWords,
            spellChecker: new FuzzySet(words),
        }
    }
}

function saveDictionary(apiDictionary: PersistedDictionary): Dictionary {
    localStorage.setItem(config.dictionaryStorageKey, JSON.stringify(apiDictionary))
    return loadDictionary();
}