import {useEffect, useState} from "react";
import axios from "axios";
import FuzzySet from 'fuzzyset'
import {url} from "../../config";
import {WrongWord} from "../components/SingleWrongWord";
import {unique} from "../utils/utils";

export interface DictionaryManager {
    weHaveADictionary(): boolean;
    dictionary: OptionalDictionary;
    dictionaryUpdating: boolean;
    checkSpellings(toCheck: string[]): Promise<string[]>;
    retryDictionaryDownload();
    suggestCorrections(word: string, correctionCount: 5): WrongWord;
    addWordLocal(word: string);
    addWordGlobal(word: string);
    clearLocalDictionary();
}

interface GlobalSuggestion {
    word: string;
    synced: boolean;
}

interface APIDictionary {
    id: number,
    words: string[],
    language: string,
}

interface PersistedDictionary extends APIDictionary {
    localWords: string[],
    globalSuggestions: GlobalSuggestion[],
}

interface Dictionary extends PersistedDictionary{
    indexedWords: { [word: string]: boolean },
    spellChecker: FuzzySet,
}

type OptionalDictionary = Dictionary | null;

const dictionaryStorageKey = 'lingoDictionary';
const language = 'Luganda';

const minSimilarityScore = .7;

export function useDictionaryManager(): DictionaryManager {
    const [dictionary, setDictionary] = useState<OptionalDictionary>(loadDictionary());
    const [ongoingAPICall, setOngoingAPICall] = useState<boolean>(false);

    function checkSpellings(toCheck: string[]): Promise<string[]> {
        return Promise.resolve(
            toCheck
            .filter(word => !dictionary.indexedWords[word])
        );
    }

    function suggestCorrections(word: string): WrongWord {
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
        fetchDictionary(language)
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
        checkWeHaveTheLatestVersion(dictionary)
            .then(weDo => {
                if (!weDo) mutexFetchDictionary();
            })
            .finally(() => setOngoingAPICall(false));
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

function fetchDictionary(languageName: string): Promise<Dictionary> {
    return axios.get(`${url}/languages/${languageName}/dictionaries/versions/latest`).then(result => result.data.data);
}

function checkWeHaveTheLatestVersion(dictionary: OptionalDictionary) {
    if (!dictionary) return Promise.resolve(false);
    return axios.get(`${url}/dictionaries/versions/${dictionary.id}/is_latest`).then(result => result.data.data.is_latest);
}

function loadDictionary(): OptionalDictionary {
    const savedDictionary = localStorage.getItem(dictionaryStorageKey);

    if (savedDictionary === null) return null;
    else {
        const dictionary: PersistedDictionary = JSON.parse(savedDictionary);
        const words = unique([...dictionary.words, ...dictionary.localWords, ...dictionary.globalSuggestions.map(globalSuggestion => globalSuggestion.word)]);

        return {
            ...dictionary,
            indexedWords: words.reduce((previousValue, currentValue) => ({...previousValue, [currentValue]: true}), {}),
            spellChecker: new FuzzySet(words),
        }
    }
}

function saveDictionary(apiDictionary: PersistedDictionary): Dictionary {
    localStorage.setItem(dictionaryStorageKey, JSON.stringify(apiDictionary))
    return loadDictionary();
}
